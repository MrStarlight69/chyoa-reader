import * as vault from './vault.js';
import { initPlayer } from './player.js';

const $ = (id) => document.getElementById(id);
const THEMES = [
  ['frutiger-aero', 'Frutiger Aero'], ['frutiger-galaxy', 'Frutiger Galaxy'], ['alba-aero', 'Alba Aero'], ['musica-aero', 'Musica Aero'],
  ['futurism-aero', 'Futurism Aero'], ['frutiger-evil', 'Frutiger Evil'], ['dark-aero', 'Dark Aero'], ['y2k-futurism', 'Y2K Futurism'],
  ['technozen', 'Technozen'], ['helvetica-aqua-aero', 'Helvetica Aqua Aero'], ['frutiger-aurora', 'Frutiger Aurora'], ['dreamcore', 'Dreamcore'], ['webcore', 'Webcore'],
];
const FONTS = { serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif', sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', humanist: '"Frutiger", "Segoe UI", "Myriad Pro", Candara, "Gill Sans", sans-serif', mono: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace', dyslexic: 'Verdana, "Atkinson Hyperlegible", Tahoma, sans-serif' };
const PREFETCH_MAX = 6;

const prefs = Object.assign({ theme: 'frutiger-aero', fs: 19, lw: 68, lh: 1.7, font: 'theme', prefetch: true, follow: false, autosave: true, autolock: 15, proxy: '' }, JSON.parse(localStorage.getItem('cr:prefs') || '{}'));
prefs.theme = localStorage.getItem('cr:theme') || prefs.theme;
const savePrefs = () => { localStorage.setItem('cr:prefs', JSON.stringify(prefs)); localStorage.setItem('cr:theme', prefs.theme); };

const mem = new Map();        // url -> chapter (session memory cache; cleared on reload, never persisted in plaintext)
const visited = new Set();
let path = [];                // [{url, title}]
let pos = -1;                 // index into path of the current chapter
let current = null;
let prefetchToken = 0;
let followTimer = null;
let backend = 'static';   // 'server' when /api/health answers (node server.js); otherwise GitHub Pages
let backendReady = Promise.resolve('static');
let preferredProxy = null;
let nextFetchAt = 0;
let fetchChain = Promise.resolve();
const fetchInflight = new Map();

// ---------- utilities ----------
let toastT;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function absolutize(ch) {
  const fix = (u) => {
    if (!u) return u;
    try { return ChyoaFetch.normalizeUrl(u); }
    catch { try { return new URL(u, 'https://chyoa.com/').toString(); } catch { return u; } }
  };
  ch.url = fix(ch.url);
  ch.previousUrl = fix(ch.previousUrl);
  ch.storyUrl = fix(ch.storyUrl);
  if (ch.authorUrl) ch.authorUrl = fix(ch.authorUrl);
  ch.choices = (ch.choices || []).map((c) => ({ ...c, url: fix(c.url) }));
  return ch;
}
function enqueueFetch(fn) {
  const run = fetchChain.then(fn, fn);
  fetchChain = run.then(() => {}, () => {});
  return run;
}
async function politeGap() {
  const wait = Math.max(0, nextFetchAt - Date.now());
  nextFetchAt = Date.now() + wait + ChyoaFetch.MIN_GAP_MS;
  if (wait > 0) await sleep(wait);
}
function orderProxies(list) {
  if (!preferredProxy) return list;
  const i = list.findIndex((p) => p.id === preferredProxy);
  if (i <= 0) return list;
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}
function finalChapterUrl(headerUrl, packedUrl, requested) {
  for (const c of [headerUrl, packedUrl]) {
    if (!c) continue;
    try {
      const u = new URL(c, 'https://chyoa.com');
      if (/^(www\.)?chyoa\.com$/i.test(u.hostname)) return u.toString();
    } catch { /* ignore a proxy URL we cannot parse */ }
  }
  return requested;
}
async function fetchStaticNow(url) {
  const proxies = orderProxies(ChyoaFetch.proxiesFor(prefs.proxy));
  let last = null;
  for (const proxy of proxies) {
    await politeGap();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(proxy.build(url), { signal: ctrl.signal, cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', headers: { Accept: 'text/html,application/xhtml+xml,application/json' } });
      const raw = await res.text();
      const packed = ChyoaFetch.payloadFromProxy(raw);
      const kind = ChyoaFetch.classifyBody(packed.body, res.status);
      if (kind !== 'chapter') {
        const why = kind === 'challenge' ? `${proxy.id} got Cloudflare's challenge page`
          : kind === 'rate' ? `${proxy.id} rate-limited the request`
          : `${proxy.id} did not return a CHYOA page (HTTP ${res.status})`;
        last = Object.assign(new Error(why), { code: 'PROXY' });
        continue;
      }
      let headerFinal = null;
      try { headerFinal = res.headers.get('X-Final-Url'); } catch { /* some proxies hide headers */ }
      const finalUrl = finalChapterUrl(headerFinal, packed.finalUrl, url);
      let data;
      try { data = absolutize(ChyoaParse.parseChapter(packed.body, finalUrl)); }
      catch (e) {
        if (e.code === 'MARKUP_CHANGED' && (res.status === 404 || res.headers.get('X-Upstream-Status') === '404')) {
          throw Object.assign(new Error('CHYOA returned 404 Not Found for this URL.'), { code: 'NOT_FOUND' });
        }
        throw e;
      }
      data.fetchedAt = new Date().toISOString();
      data.requestedUrl = url;
      data.via = proxy.id;
      preferredProxy = proxy.id;
      const note = $('proxyStatus');
      if (note) note.textContent = proxy.custom ? 'Last fetch used your proxy.' : `Last fetch used the public proxy ${proxy.id}. It can see the chapter URL.`;
      return data;
    } catch (e) {
      if (e.code && e.code !== 'PROXY') throw e;
      last = Object.assign(new Error(e.name === 'AbortError' ? `${proxy.id} timed out after 20 s` : (e.message || String(e))), { code: 'PROXY' });
    } finally { clearTimeout(to); }
  }
  const lead = prefs.proxy
    ? 'Your CORS proxy did not return this chapter. Public proxies were not contacted. '
    : 'Every public CORS proxy failed. ';
  throw Object.assign(new Error(lead + (last ? last.message + '. ' : '') + 'Save the chapter from your browser (HTML only) and use the HTML button, or set your own proxy in Settings.'), { code: 'PROXY' });
}
function fetchStatic(url) {
  if (fetchInflight.has(url)) return fetchInflight.get(url);
  const p = enqueueFetch(() => fetchStaticNow(url));
  fetchInflight.set(url, p);
  p.finally(() => { if (fetchInflight.get(url) === p) fetchInflight.delete(url); });
  return p;
}
async function apiServer(url) {
  let res;
  try { res = await fetch(new URL('api/chapter?url=' + encodeURIComponent(url), document.baseURI), { cache: 'no-store' }); }
  catch { throw Object.assign(new Error('The local reader server is not reachable. Is `npm start` still running?'), { code: 'LOCAL' }); }
  const j = await res.json().catch(() => ({ ok: false, error: `Unexpected response (HTTP ${res.status})` }));
  if (!j.ok) throw Object.assign(new Error(j.error), { code: j.code });
  return j.chapter;
}
async function api(url) {
  await backendReady;
  if (backend === 'server') return apiServer(url);
  return fetchStatic(url);
}
async function detectBackend() {
  try {
    const res = await fetch(new URL('api/health', document.baseURI), { cache: 'no-store' });
    if (res.ok) {
      const j = await res.json();
      if (j && j.ok === true) return 'server';
    }
  } catch { /* static host, or the health check is not JSON */ }
  return 'static';
}
backendReady = detectBackend().then((mode) => { backend = mode; updateModeNote(); return mode; });
function updateModeNote() {
  const n = $('fetchNote');
  if (!n) return;
  n.textContent = backend === 'server'
    ? 'This tab is using the local server, which fetches chyoa.com directly.'
    : 'Chapters are loaded through a public CORS proxy unless you set your own in Settings. The proxy can see the URL you request. Your passphrase stays in this browser. If the proxies fail, use the HTML button.';
}
async function openHtmlFile(file, hintedUrl) {
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) return showError(Object.assign(new Error('That file is over 3 MB. Save the chapter as “HTML only”, not “Webpage, complete”.'), { code: 'BAD_URL' }), hintedUrl);
  let html;
  try { html = await file.text(); } catch { return showError(Object.assign(new Error('Could not read that file.'), { code: 'BAD_URL' })); }
  let url = null;
  for (const candidate of [hintedUrl, ChyoaFetch.urlFromSavedHtml(html), $('urlInput').value]) {
    if (!candidate) continue;
    try { url = ChyoaFetch.normalizeUrl(candidate); break; } catch { /* try the next hint */ }
  }
  if (!url) return showError(Object.assign(new Error('This file has no CHYOA chapter address. Paste the chapter URL above, then open the HTML again.'), { code: 'BAD_URL' }));
  let ch;
  try { ch = absolutize(ChyoaParse.parseChapter(html, url)); }
  catch (e) { return showError(e, url); }
  ch.fetchedAt = new Date().toISOString();
  ch.via = 'file';
  mem.set(url, ch);
  if (ch.url !== url) mem.set(ch.url, ch);
  $('urlInput').value = ch.url;
  load(ch.url, 'new', { chapter: ch });
}

// ---------- theming & reading prefs ----------
function applyPrefs() {
  const r = document.documentElement;
  r.dataset.theme = prefs.theme;
  r.style.setProperty('--fs', prefs.fs + 'px');
  r.style.setProperty('--lw', prefs.lw + 'ch');
  r.style.setProperty('--lh', prefs.lh);
  if (prefs.font === 'theme') r.style.removeProperty('--font-read'); else r.style.setProperty('--font-read', FONTS[prefs.font]);
  $('fsRange').value = prefs.fs; $('fsOut').textContent = prefs.fs + 'px';
  $('lwRange').value = prefs.lw; $('lwOut').textContent = prefs.lw + 'ch';
  $('lhRange').value = prefs.lh; $('lhOut').textContent = (+prefs.lh).toFixed(2);
  $('fontSel').value = prefs.font; $('optPrefetch').checked = prefs.prefetch; $('optFollow').checked = prefs.follow; $('optAutosave').checked = prefs.autosave; $('autolockSel').value = String(prefs.autolock);
  if ($('proxyInput') && document.activeElement !== $('proxyInput')) $('proxyInput').value = prefs.proxy || '';
  document.querySelectorAll('.theme-card').forEach((b) => b.setAttribute('aria-pressed', b.dataset.t === prefs.theme));
  const m = document.querySelector('meta[name=theme-color]');
  savePrefs();
}
export function setTheme(t) { prefs.theme = t; applyPrefs(); toast(`Theme: ${THEMES.find((x) => x[0] === t)?.[1] || t}`, 1400); }
function cycleTheme(d) { const i = THEMES.findIndex((x) => x[0] === prefs.theme); setTheme(THEMES[(i + d + THEMES.length) % THEMES.length][0]); }
function buildThemeGrid() {
  const g = $('themeGrid');
  THEMES.forEach(([id, name]) => {
    const b = document.createElement('button');
    b.className = 'theme-card'; b.dataset.t = id; b.type = 'button';
    b.innerHTML = `<span class="sw" data-t="${id}"></span><span class="n">${name}</span>`;
    b.onclick = () => setTheme(id);
    g.appendChild(b);
  });
}

// ---------- reader ----------
function showOnly(which) {
  ['welcome', 'reader', 'error'].forEach((id) => $(id).classList.toggle('hidden', id !== which));
}
function showError(e, url) {
  const titles = { NOT_FOUND: 'Chapter not found', LOGIN_REQUIRED: 'Login required', BLOCKED: 'Blocked by CHYOA\'s CDN', RATE_LIMITED: 'Slow down', MARKUP_CHANGED: 'Couldn\'t read this page', BAD_URL: 'That URL won\'t work', NETWORK: 'Network problem', LOCAL: 'Server offline', UPSTREAM: 'CHYOA error', PROXY: 'Could not fetch the chapter' };
  const box = $('error');
  box.innerHTML = `<h2>${esc(titles[e.code] || 'Something went wrong')}</h2><p>${esc(e.message)}</p>` +
    (url ? `<p class="small"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open on CHYOA ↗</a></p>` : '') +
    (current ? `<p><button class="btn" id="errBack">← Back to “${esc(current.chapterTitle)}”</button></p>` : '');
  if (e.code === 'PROXY' || e.code === 'BLOCKED' || e.code === 'NETWORK') {
    const row = document.createElement('p');
    const lab = document.createElement('label');
    lab.className = 'btn';
    lab.textContent = 'Open saved HTML';
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.html,.htm,text/html'; input.hidden = true;
    input.addEventListener('change', (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) openHtmlFile(f, url); });
    lab.appendChild(input);
    row.appendChild(lab);
    box.appendChild(row);
  }
  showOnly('error');
  const b = $('errBack'); if (b) b.onclick = () => render(current);
}

async function getChapter(url) {
  url = ChyoaFetch.normalizeUrl(url);
  if (mem.has(url)) return mem.get(url);
  const ch = await api(url);
  mem.set(url, ch); if (ch.url !== url) mem.set(ch.url, ch);
  return ch;
}

// mode: 'push' (follow a choice), 'new' (fresh URL), 'jump' (to path index), 'parent'
async function load(url, mode = 'push', opts = {}) {
  cancelFollow();
  try { url = ChyoaFetch.normalizeUrl(url); }
  catch (e) { showError(e, url); return; }
  let ch = opts.chapter || mem.get(url);
  if (!ch && vault.isUnlocked()) ch = vault.findByUrl(url) || null;
  if (!ch) {
    $('loading').classList.remove('hidden');
    try { ch = await getChapter(url); }
    catch (e) { $('loading').classList.add('hidden'); showError(e, url); return; }
    $('loading').classList.add('hidden');
  }
  mem.set(ch.url, ch);
  if (mode === 'new') { path = [{ url: ch.url, title: ch.chapterTitle }]; pos = 0; }
  else if (mode === 'push') { path = path.slice(0, pos + 1); path.push({ url: ch.url, title: ch.chapterTitle }); pos = path.length - 1; }
  else if (mode === 'jump') { pos = opts.index; }
  else if (mode === 'parent') { if (pos > 0) pos--; else { path.unshift({ url: ch.url, title: ch.chapterTitle }); pos = 0; } }
  visited.add(ch.url);
  render(ch);
  window.scrollTo({ top: 0, behavior: 'instant' });
  history.replaceState(null, '', `#${encodeURIComponent(ch.url)}`);
  if (prefs.autosave && vault.isUnlocked()) vault.save(ch).then(() => {}, (e) => toast(e.message));
  persistSession();
  if (prefs.prefetch) prefetchChoices(ch);
}

function render(ch) {
  current = ch;
  showOnly('reader');
  const story = $('chStory');
  story.textContent = ch.storyTitle || 'CHYOA';
  story.href = '#'; story.onclick = (e) => { e.preventDefault(); if (ch.storyUrl) load(ch.storyUrl, 'new'); };
  $('chArrived').textContent = ch.arrivedVia ? `“${ch.arrivedVia}”` : (ch.description || '');
  $('chTitle').textContent = ch.chapterTitle || 'Untitled';
  const mins = Math.max(1, Math.round((ch.words || 0) / 230));
  $('chMeta').innerHTML = [ch.chapterNumber ? `Chapter ${ch.chapterNumber}` : null, ch.author ? `by <a href="${esc(ch.authorUrl)}" target="_blank" rel="noopener noreferrer">${esc(ch.author)}</a>` : null, `${(ch.words || 0).toLocaleString()} words · ~${mins} min`, ch.savedAt ? '🔒 from library' : null].filter(Boolean).join(' · ');
  const notes = [];
  if ((ch.notes || []).includes('images-login')) notes.push('Some images in this chapter are only shown to logged-in CHYOA members, so they appear as placeholders here.');
  if ((ch.notes || []).includes('empty')) notes.push('This chapter appears to have no text.');
  $('chNotes').innerHTML = notes.map((n) => `<div class="note">${esc(n)}</div>`).join('');
  $('chBody').innerHTML = ch.html; // allowlist-sanitized by the parser — and the local server's CSP blocks inline scripts anyway
  $('chQuestion').textContent = ch.choices?.length ? (ch.question || 'What happens next?') : '';
  const ol = $('choiceList'); ol.innerHTML = '';
  if (!ch.choices?.length) ol.innerHTML = '<li class="ending">— The End (no further chapters on this branch yet) —</li>';
  ch.choices?.forEach((c, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'choice' + (visited.has(c.url) ? ' visited' : ''); b.type = 'button'; b.dataset.url = c.url;
    b.innerHTML = `<span class="num">${i < 9 ? i + 1 : '•'}</span><span class="t"></span><span class="st"></span>`;
    b.querySelector('.t').textContent = c.title;
    b.onclick = () => load(c.url, 'push');
    li.appendChild(b); ol.appendChild(li);
    markChoice(c.url);
  });
  $('btnParent').classList.toggle('hidden', !(ch.previousUrl || pos > 0));
  $('btnOrig').href = ch.url;
  $('btnSave').textContent = vault.isUnlocked() && vault.findByUrl(ch.url) ? '✓ Saved' : '⤓ Save';
  renderCrumbs();
  document.title = `${ch.chapterTitle} · ${ch.storyTitle} — Aero Reader`;
  updateProgress();
}
function markChoice(url) {
  const b = document.querySelector(`.choice[data-url="${CSS.escape(url)}"] .st`);
  if (!b) return;
  const inLib = vault.isUnlocked() && vault.findByUrl(url);
  b.textContent = visited.has(url) ? '✓ read' : mem.has(url) ? '⚡ ready' : inLib ? '🔒 saved' : '';
}
function renderCrumbs() {
  const c = $('crumbs'); c.innerHTML = '';
  c.classList.toggle('hidden', path.length < 1);
  const start = Math.max(0, path.length - 12);
  if (start > 0) c.insertAdjacentHTML('beforeend', '<span class="sep">…</span>');
  path.slice(start).forEach((p, j) => {
    const i = start + j;
    if (j) c.insertAdjacentHTML('beforeend', '<span class="sep">›</span>');
    const b = document.createElement('button');
    b.textContent = p.title || '?'; b.title = p.title; if (i === pos) b.className = 'current';
    b.onclick = () => load(p.url, 'jump', { index: i });
    c.appendChild(b);
  });
}

async function prefetchChoices(ch) {
  const token = ++prefetchToken;
  const todo = (ch.choices || []).filter((c) => !mem.has(c.url) && !(vault.isUnlocked() && vault.findByUrl(c.url))).slice(0, PREFETCH_MAX);
  for (const c of todo) {
    if (token !== prefetchToken) return; // user moved on; stop
    try { await getChapter(c.url); markChoice(c.url); } catch { /* ignore; real click will show the error */ }
    await sleep(300); // the fetch queue also waits ≥1.5 s between upstream requests
  }
}

// follow path: auto-continue single-choice chapters once you reach the end
function cancelFollow() { clearInterval(followTimer); followTimer = null; $('followBox').classList.add('hidden'); }
function maybeFollow() {
  if (!prefs.follow || followTimer || !current || current.choices?.length !== 1) return;
  let n = 5; const box = $('followBox');
  box.innerHTML = `<span>Following path in <b id="fN">${n}</b>s…</span><button class="btn small" id="fGo">Go now</button><button class="btn small" id="fStop">Cancel</button>`;
  box.classList.remove('hidden');
  const go = () => { cancelFollow(); load(current.choices[0].url, 'push'); };
  $('fGo').onclick = go; $('fStop').onclick = () => { cancelFollow(); followTimer = -1; };
  followTimer = setInterval(() => { n--; const el = $('fN'); if (el) el.textContent = n; if (n <= 0) go(); }, 1000);
}

function updateProgress() {
  const h = document.documentElement;
  const max = h.scrollHeight - h.clientHeight;
  const p = max > 0 ? Math.min(1, h.scrollTop / max) : 1;
  $('progress').firstElementChild.style.width = (current && !$('reader').classList.contains('hidden') ? p * 100 : 0) + '%';
  if (p > 0.97 && current) maybeFollow();
}

// ---------- library ----------
async function persistSession() { if (vault.isUnlocked()) vault.saveSession({ path, pos, theme: prefs.theme }).catch(() => {}); }
let autolockT;
function bumpAutolock() {
  clearTimeout(autolockT);
  if (prefs.autolock > 0 && vault.isUnlocked()) autolockT = setTimeout(() => { vault.lock(); toast('Library auto-locked'); }, prefs.autolock * 60000);
}
async function refreshLibrary() {
  const unlocked = vault.isUnlocked();
  const has = await vault.exists().catch(() => false);
  $('btnLibrary').textContent = unlocked ? '🔓 Library' : '🔒 Library';
  $('btnLock').classList.toggle('hidden', !unlocked);
  $('libLocked').classList.toggle('hidden', unlocked);
  $('libOpen').classList.toggle('hidden', !unlocked);
  if (!vault.supported()) { $('libLockedMsg').textContent = 'WebCrypto/IndexedDB is unavailable. Open the reader via http://localhost (a secure context) to use the encrypted library.'; $('unlockForm').classList.add('hidden'); return; }
  if (!unlocked) {
    $('libLockedMsg').innerHTML = has ? 'Your library is <b>locked</b>. Enter your passphrase to decrypt it.' : 'Create a passphrase to start your encrypted library. Every chapter you read will be stored encrypted on this device.';
    $('passInput2').classList.toggle('hidden', has); $('passInput2').required = !has;
    $('unlockBtn').textContent = has ? 'Unlock' : 'Create library';
    $('passInput').autocomplete = has ? 'current-password' : 'new-password';
    return;
  }
  const q = $('libSearch').value.trim().toLowerCase();
  const items = vault.list().filter((c) => !q || `${c.storyTitle} ${c.chapterTitle} ${c.author}`.toLowerCase().includes(q));
  const groups = new Map();
  items.forEach((c) => { const k = c.storyTitle || 'Unknown story'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
  const list = $('libList'); list.innerHTML = '';
  $('libStats').textContent = `${vault.list().length} chapter(s) across ${new Set(vault.list().map((c) => c.storyTitle)).size} stor(ies) · encrypted at rest`;
  [...groups.entries()].sort().forEach(([story, chs]) => {
    const d = document.createElement('div'); d.className = 'lib-story';
    d.innerHTML = `<h4></h4>`; d.querySelector('h4').textContent = story;
    chs.sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0) || a.savedAt.localeCompare(b.savedAt)).forEach((c) => {
      const row = document.createElement('div'); row.className = 'lib-item';
      row.innerHTML = `<button class="open"></button><span class="when"></span><button class="del" title="Delete from library" aria-label="Delete">🗑</button>`;
      row.querySelector('.open').textContent = `${c.chapterNumber ? c.chapterNumber + '. ' : ''}${c.chapterTitle}`;
      row.querySelector('.when').textContent = new Date(c.savedAt).toLocaleDateString();
      row.querySelector('.open').onclick = () => { closeDrawers(); load(c.url, 'new', { chapter: c }); };
      row.querySelector('.del').onclick = async () => { if (confirm(`Delete “${c.chapterTitle}” from the library?`)) await vault.remove(c.id); };
      d.appendChild(row);
    });
    list.appendChild(d);
  });
  if (!items.length) list.innerHTML = `<p class="muted">${q ? 'No matches.' : 'Nothing saved yet. Chapters you read are saved automatically while the library is unlocked.'}</p>`;
}
vault.onChange(() => { refreshLibrary(); if (current) render(current); bumpAutolock(); });

$('unlockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('passInput').value, p2 = $('passInput2').value;
  $('libErr').textContent = '';
  const has = await vault.exists();
  if (!has && p1 !== p2) return ($('libErr').textContent = 'Passphrases do not match.');
  if (!has && p1.length < 8) return ($('libErr').textContent = 'Use at least 8 characters (a few random words is best).');
  $('unlockBtn').disabled = true; $('unlockBtn').textContent = 'Deriving key…';
  try {
    if (has) { const r = await vault.unlock(p1); toast(`Unlocked · ${r.count} chapter(s)${r.bad ? ` · ${r.bad} unreadable` : ''}`); }
    else { await vault.create(p1); toast('Encrypted library created'); }
    $('passInput').value = $('passInput2').value = '';
    if (current && prefs.autosave) vault.save(current).catch(() => {});
    if (!current) { const s = await vault.loadSession(); if (s?.path?.length) { path = s.path; pos = s.pos; load(path[pos].url, 'jump', { index: pos }); } }
  } catch (err) { $('libErr').textContent = err.message; }
  finally { $('unlockBtn').disabled = false; refreshLibrary(); }
});
const doLock = () => { vault.lock(); toast('Library locked 🔒'); };
$('btnLock').onclick = doLock; $('btnLock2').onclick = doLock;
$('libSearch').addEventListener('input', refreshLibrary);
$('btnExport').onclick = async () => {
  try {
    const blob = await vault.exportBlob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `chyoa-library-encrypted-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Encrypted backup downloaded');
  } catch (e) { toast(e.message); }
};
$('importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { const r = await vault.importFile(f, async (msg) => prompt(msg)); toast(r.mode === 'adopted' ? `Imported ${r.added} chapter(s). Unlock with the backup's passphrase.` : `Imported ${r.added} new chapter(s) (${r.mode})`, 4000); }
  catch (err) { toast(err.message, 4000); }
  refreshLibrary();
});
$('btnWipe').onclick = async () => { if (confirm('Erase the ENTIRE encrypted library on this device? This cannot be undone.')) { await vault.wipe(); toast('Library erased'); } };
$('btnSave').onclick = async () => {
  if (!current) return;
  if (!vault.isUnlocked()) { openDrawer('library'); return toast('Unlock the library to save'); }
  await vault.save(current); toast('Saved to encrypted library');
};
$('btnParent').onclick = () => {
  if (pos > 0) return load(path[pos - 1].url, 'jump', { index: pos - 1 });
  if (current?.previousUrl) load(current.previousUrl, 'parent');
};

// links inside a chapter that point at other CHYOA chapters open in the reader
$('chBody').addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (a && /^https:\/\/(www\.)?chyoa\.com\/(story|chapter)\/[^/]+\.\d+\/?$/.test(a.href)) { e.preventDefault(); load(a.href, 'push'); }
});

// ---------- drawers / ui wiring ----------
function closeDrawers() { document.querySelectorAll('.drawer').forEach((d) => d.classList.add('hidden')); }
function openDrawer(id) { const d = $(id); const was = d.classList.contains('hidden'); closeDrawers(); if (was) d.classList.remove('hidden'); if (id === 'library' && was) { $('libErr').textContent = ''; if (!vault.isUnlocked()) $('passInput').focus(); refreshLibrary(); } }
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeDrawers));
$('btnSettings').onclick = () => openDrawer('settings');
$('btnLibrary').onclick = () => openDrawer('library');
$('btnHelp').onclick = () => openDrawer('help');
$('btnBack').onclick = () => goBack();
function goBack() { if (pos > 0) load(path[pos - 1].url, 'jump', { index: pos - 1 }); else toast('Start of your path'); }

$('urlForm').addEventListener('submit', (e) => { e.preventDefault(); const u = $('urlInput').value.trim(); if (u) { load(normalizeInput(u), 'new'); $('urlInput').blur(); } });
$('htmlFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) openHtmlFile(f); });
$('proxyInput').addEventListener('change', (e) => { prefs.proxy = e.target.value.trim(); preferredProxy = null; savePrefs(); const note = $('proxyStatus'); if (note) note.textContent = prefs.proxy ? 'Custom proxy saved. Public proxies will not be used.' : 'Custom proxy cleared. Public proxies are back on.'; });
function normalizeInput(u) { return /^https?:/i.test(u) ? u : 'https://' + u.replace(/^\/+/, ''); }

const bindRange = (id, key, num = Number) => $(id).addEventListener('input', (e) => { prefs[key] = num(e.target.value); applyPrefs(); });
bindRange('fsRange', 'fs'); bindRange('lwRange', 'lw'); bindRange('lhRange', 'lh');
$('fontSel').onchange = (e) => { prefs.font = e.target.value; applyPrefs(); };
$('optPrefetch').onchange = (e) => { prefs.prefetch = e.target.checked; applyPrefs(); if (prefs.prefetch && current) prefetchChoices(current); };
$('optFollow').onchange = (e) => { prefs.follow = e.target.checked; applyPrefs(); };
$('optAutosave').onchange = (e) => { prefs.autosave = e.target.checked; applyPrefs(); };
$('autolockSel').onchange = (e) => { prefs.autolock = Number(e.target.value); applyPrefs(); bumpAutolock(); };

const player = initPlayer(toast);
$('btnMusic').onclick = () => player.toggleOpen();

addEventListener('scroll', updateProgress, { passive: true });
addEventListener('resize', updateProgress);
['pointerdown', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, () => { if (vault.isUnlocked()) bumpAutolock(); }, { passive: true }));

addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) { if (e.key === 'Escape') e.target.blur(); return; }
  const k = e.key;
  if (k === 'Escape') return closeDrawers();
  if (k === '/') { e.preventDefault(); return $('urlInput').focus(); }
  if (k === '?') return openDrawer('help');
  if (k === 't') return cycleTheme(1);
  if (k === 'T') return cycleTheme(-1);
  if (k === 'l' || k === 'L') return openDrawer('library');
  if (k === 's' || k === 'S') return openDrawer('settings');
  if (k === 'm' || k === 'M') return player.toggleOpen();
  if (k === 'p' || k === 'P') return player.togglePlay();
  if (k === '+' || k === '=') { prefs.fs = Math.min(30, prefs.fs + 1); return applyPrefs(); }
  if (k === '-' || k === '_') { prefs.fs = Math.max(14, prefs.fs - 1); return applyPrefs(); }
  if (k === ']') { prefs.lw = Math.min(100, prefs.lw + 4); return applyPrefs(); }
  if (k === '[') { prefs.lw = Math.max(40, prefs.lw - 4); return applyPrefs(); }
  if (k === 'j') return scrollBy({ top: innerHeight * 0.4, behavior: 'smooth' });
  if (k === 'k') return scrollBy({ top: -innerHeight * 0.4, behavior: 'smooth' });
  if (k === 'ArrowLeft') return goBack();
  if (!current || $('reader').classList.contains('hidden')) return;
  if (k === 'ArrowRight' && current.choices?.length) return load(current.choices[0].url, 'push');
  if (/^[1-9]$/.test(k)) { const c = current.choices?.[Number(k) - 1]; if (c) load(c.url, 'push'); }
});

// ---------- boot ----------
buildThemeGrid();
applyPrefs();
refreshLibrary();
updateModeNote();
backendReady.then(() => {
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const fromQuery = new URLSearchParams(location.search).get('url');
  if (fromQuery || /chyoa\.com\//.test(fromHash)) { $('urlInput').value = fromQuery || fromHash; load(fromQuery || fromHash, 'new'); }
});
// test hooks (used by tests/e2e.js; harmless otherwise)
window.__reader = { setTheme, THEMES, load, state: () => ({ path, pos, current, unlocked: vault.isUnlocked(), saved: vault.isUnlocked() ? vault.list().length : null, prefetched: [...mem.keys()] }) };
