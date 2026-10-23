// Cipher panel for the reader. The substitution rules live in lib/cipher.js
// (same AO3CIPHER / AO3SUB format as ao3-fic-encryptor). This file is the tabs,
// saved ciphers, chapter display, and reading mode.
import * as idb from './db.js';

const C = () => window.ChyoaCipher;
const $ = (id) => document.getElementById(id);
const STORE = 'cr:ciphers';
const te = new TextEncoder();

const ERR = {
  FORMAT: "That doesn't look like encrypted text. It should start with AO3SUB$.",
  FINGERPRINT: 'This text was made with a different cipher. Paste that cipher key, or choose the matching saved cipher.',
  BADTEXT: 'The cipher text is damaged, or this is the wrong cipher.',
  INCOMPLETE: 'The cipher text is cut off.',
  NONKEY: 'The cipher text contains a character this page cannot read.',
  VERSION: 'That cipher text version is not supported.',
  OLDFORMAT: 'That file uses an older format this reader does not open.',
  BADKEY: 'That cipher key is not valid. It should look like AO3CIPHER$1$…$.',
  FMTCHECK: 'Could not read that formatted cipher text.',
};

function defaultState() {
  const key = C().juniperKey();
  return {
    ciphers: [{ sid: 'juniper', name: 'Juniper', key, created: '2026-01-01T00:00:00.000Z' }],
    selected: 'juniper',
    showEncrypted: true,
    encryptChoices: false,
    bookmarks: {},
  };
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || '');
    if (s && Array.isArray(s.ciphers) && s.ciphers.length && s.ciphers.every((c) => c && C().isValidKey(c.key) && c.sid)) {
      s.showEncrypted = s.showEncrypted !== false;
      s.encryptChoices = !!s.encryptChoices;
      s.bookmarks = s.bookmarks && typeof s.bookmarks === 'object' ? s.bookmarks : {};
      if (!s.ciphers.some((c) => c.sid === s.selected)) s.selected = s.ciphers[0].sid;
      return s;
    }
  } catch { /* fresh */ }
  return defaultState();
}

function uniqueName(state, name) {
  const base = (name || 'Cipher').slice(0, 60);
  const names = new Set(state.ciphers.map((c) => c.name));
  if (!names.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const next = `${base.slice(0, 54)} (${n})`;
    if (!names.has(next)) return next;
  }
  return base;
}

function download(filename, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function copyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (ok) return Promise.resolve();
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error('Copy failed'));
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 31) + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
function errText(e) {
  const code = e && (e.code || e.message);
  return ERR[code] || (e && e.message) || 'Something went wrong.';
}

export function createCipher({ toast, onChange, vault }) {
  const state = loadState();
  let draft = [];
  let chapter = null;
  let lastPlain = '';
  let lastDecKey = null;
  let read = null;

  const persist = () => localStorage.setItem(STORE, JSON.stringify(state));
  const selected = () => state.ciphers.find((c) => c.sid === state.selected) || state.ciphers[0];
  const dirty = () => {
    const c = selected();
    return draft.join('') !== c.key || ($('cipName') && $('cipName').value.trim() !== c.name);
  };

  function setStatus(id, msg, kind) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('bad', kind === 'bad');
    el.classList.toggle('good', kind === 'good');
  }

  function fillSelects() {
    for (const id of ['ciphEncSel', 'ciphDecSel', 'cipSel']) {
      const sel = $(id);
      if (!sel) continue;
      const prev = sel.value;
      sel.innerHTML = '';
      for (const c of state.ciphers) {
        const o = document.createElement('option');
        o.value = c.sid;
        o.textContent = `${c.name} · ${C().fingerprint(c.key)}`;
        sel.appendChild(o);
      }
      sel.value = state.selected || prev;
    }
    const c = selected();
    const fp = C().fingerprint(c.key);
    if ($('ciphEncFp')) $('ciphEncFp').textContent = fp;
    if ($('ciphDecFp')) $('ciphDecFp').textContent = fp;
    if ($('cipKeyOut')) $('cipKeyOut').value = C().exportKey(c.key);
  }

  function loadDraft(sid) {
    const c = state.ciphers.find((x) => x.sid === sid) || selected();
    draft = c.key.split('');
    if ($('cipName')) $('cipName').value = c.name;
    paint(true);
    setStatus('cipStatus', '');
    const fp = C().isValidKey(draft.join('')) ? C().fingerprint(draft.join('')) : '——';
    if ($('cipFp')) $('cipFp').textContent = fp;
  }

  function paint(writeValues) {
    const key = draft.map((ch) => ch || '');
    const info = key.length === 95 ? C().analyzeKey(key) : { ok: false, dups: new Set(), empty: 95, self: 0 };
    document.querySelectorAll('#cgrid input').forEach((inp) => {
      const i = Number(inp.dataset.i);
      const ch = draft[i] || '';
      if (writeValues && document.activeElement !== inp) inp.value = ch === ' ' ? '␣' : ch;
      inp.classList.toggle('self', !!ch && ch === C().ALPHA[i]);
      inp.classList.toggle('dup', !!ch && info.dups && info.dups.has(ch));
      inp.classList.toggle('empty', !ch);
    });
    const fpEl = $('cipFp');
    if (C().isValidKey(key.join(''))) {
      if (fpEl) fpEl.textContent = C().fingerprint(key.join(''));
      const shared = info.injective ? '' : ' Some outputs are shared, so decrypting gives back the first character (lowercase letters first).';
      setStatus('cipStatus', info.self === 95 ? 'Nothing changes yet.' + shared : (info.injective ? 'Every character has its own output.' : 'Ready to save.' + shared));
    } else setStatus('cipStatus', `${info.empty || 0} box${info.empty === 1 ? '' : 'es'} still empty.`, 'bad');
    if ($('cipDirty')) $('cipDirty').textContent = dirty() ? 'Unsaved changes' : '';
  }

  function fromBox(v) {
    if (!v) return '';
    const ch = [...v][0];
    if (ch === '␣' || ch === ' ') return ' ';
    return C().ALPHA.includes(ch) ? ch : '';
  }

  function buildGrid() {
    const g = $('cgrid');
    if (!g || g.childElementCount) return;
    for (let i = 0; i < 95; i++) {
      const lab = document.createElement('label');
      lab.className = 'ccell';
      const s = document.createElement('span');
      s.textContent = C().ALPHA[i] === ' ' ? '␣' : C().ALPHA[i];
      const inp = document.createElement('input');
      inp.dataset.i = String(i);
      inp.maxLength = 2;
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.setAttribute('aria-label', `Output for ${C().ALPHA[i] === ' ' ? 'space' : C().ALPHA[i]}`);
      inp.addEventListener('input', () => {
        draft[i] = fromBox(inp.value);
        if (inp.value.length > 1 || draft[i] === ' ') inp.value = draft[i] === ' ' ? '␣' : (draft[i] || '');
        paint(false);
      });
      lab.append(s, inp);
      g.appendChild(lab);
    }
  }

  function applyDraft(key) {
    draft = key.split('');
    paint(true);
  }

  function selectSid(sid, opts) {
    if (!state.ciphers.some((c) => c.sid === sid)) return;
    if (!(opts && opts.force) && sid !== state.selected && dirty() && !confirm('Discard unsaved edits to this cipher?')) {
      fillSelects();
      return;
    }
    state.selected = sid;
    persist();
    fillSelects();
    loadDraft(sid);
    onChange();
    refreshChapter();
  }

  function addCipher(key, name) {
    const c = { sid: crypto.randomUUID(), name: uniqueName(state, name), key, created: new Date().toISOString() };
    state.ciphers.push(c);
    state.selected = c.sid;
    persist();
    fillSelects();
    loadDraft(c.sid);
    onChange();
    refreshChapter();
    return c;
  }

  function payloadFor(ch) {
    if (!ch) return '';
    if (ch.ciphered && ch.cipherPayload) return ch.cipherPayload;
    return C().encodeBytes(te.encode(C().chapterStoryText(ch, { choices: state.encryptChoices })), selected().key);
  }

  function cipherHtml(html, key) {
    const doc = new DOMParser().parseFromString(`<div id="root">${html || ''}</div>`, 'text/html');
    const root = doc.getElementById('root');
    for (const img of root.querySelectorAll('img')) {
      const alt = img.getAttribute('alt');
      if (alt) img.setAttribute('alt', C().mapChars(alt, key));
    }
    const nodes = [];
    const w = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      n.data = n.data.replace(/\r\n?|\n/g, ' ');
      nodes.push(n);
    }
    if (!nodes.length) return html || '';
    const joined = nodes.map((t) => t.data).join('\n');
    const payload = C().encodeBytes(te.encode(joined), key);
    const pieces = payload.slice(payload.indexOf('\n') + 1).split('\n');
    if (pieces.length < nodes.length) throw new Error('split');
    nodes.forEach((t, i) => { t.data = pieces[i] ?? ''; });
    return root.innerHTML;
  }

  function present(ch) {
    const plainArrived = ch.arrivedVia ? `“${ch.arrivedVia}”` : (ch.description || '');
    if (ch.ciphered || !state.showEncrypted) {
      return { html: ch.html || '', arrived: plainArrived, question: ch.question || '', titles: (ch.choices || []).map((c) => c.title) };
    }
    const key = selected().key;
    let html = ch.html || '';
    try { html = cipherHtml(html, key); }
    catch {
      const body = payloadFor(ch);
      html = `<pre class="cipher-fallback">${C().escHtml(body.slice(body.indexOf('\n') + 1))}</pre>`;
    }
    return {
      html,
      arrived: ch.arrivedVia ? `“${C().mapChars(ch.arrivedVia, key)}”` : (ch.description ? C().mapChars(ch.description, key) : ''),
      question: state.encryptChoices && ch.question ? C().mapChars(ch.question, key) : (ch.question || ''),
      titles: (ch.choices || []).map((c) => (state.encryptChoices ? C().mapChars(c.title, key) : c.title)),
    };
  }

  function libraryRecord(ch) {
    if (ch.ciphered && ch.cipherPayload) return ch;
    const key = selected().key;
    const c = selected();
    let html = '';
    try { html = cipherHtml(ch.html || '', key); }
    catch { html = `<pre class="cipher-fallback">${C().escHtml(payloadFor(ch))}</pre>`; }
    return {
      url: ch.url, storyTitle: ch.storyTitle, storyUrl: ch.storyUrl, storyId: ch.storyId,
      chapterTitle: ch.chapterTitle, chapterNumber: ch.chapterNumber,
      author: ch.author, authorUrl: ch.authorUrl,
      arrivedVia: ch.arrivedVia ? C().mapChars(ch.arrivedVia, key) : ch.arrivedVia,
      description: ch.description ? C().mapChars(ch.description, key) : ch.description,
      html, words: ch.words,
      question: state.encryptChoices && ch.question ? C().mapChars(ch.question, key) : ch.question,
      choices: (ch.choices || []).map((choice) => ({
        id: choice.id, url: choice.url,
        title: state.encryptChoices ? C().mapChars(choice.title, key) : choice.title,
      })),
      previousUrl: ch.previousUrl, isStoryPage: ch.isStoryPage, notes: ch.notes, fetchedAt: ch.fetchedAt,
      cipherPayload: payloadFor(ch), cipherFp: C().fingerprint(key), cipherName: c.name, ciphered: true,
    };
  }

  function refreshChapter() {
    const ch = chapter;
    const box = $('ciphPayload');
    if (!box) return;
    const payload = ch ? payloadFor(ch) : '';
    box.value = payload;
    const c = selected();
    if ($('ciphHead')) $('ciphHead').textContent = ch ? (ch.storyTitle ? `${ch.storyTitle} — ${ch.chapterTitle || ''}` : (ch.chapterTitle || 'Chapter')) : 'No chapter loaded yet';
    if ($('ciphCount')) $('ciphCount').textContent = payload ? `${payload.length.toLocaleString()} characters · ID ${ch && ch.ciphered ? (ch.cipherFp || '') : C().fingerprint(c.key)}` : '';
    if ($('ciphPreview')) {
      if (!ch) $('ciphPreview').textContent = '';
      else if (ch.ciphered) $('ciphPreview').innerHTML = ch.html || '';
      else {
        try { $('ciphPreview').innerHTML = cipherHtml(ch.html || '', c.key); }
        catch { $('ciphPreview').textContent = payload.slice(payload.indexOf('\n') + 1); }
      }
    }
    const live = !!(ch && !ch.ciphered);
    for (const id of ['ciphCopy', 'ciphTxt', 'ciphHtml', 'ciphRead']) {
      if ($(id)) $(id).disabled = !payload;
    }
    if ($('ciphLive')) $('ciphLive').classList.toggle('hidden', !live && !ch);
  }

  function syncChecks() {
    if ($('ciphShow')) $('ciphShow').checked = state.showEncrypted;
    if ($('ciphChoices')) $('ciphChoices').checked = state.encryptChoices;
    if ($('ciphShow2')) $('ciphShow2').checked = state.showEncrypted;
    if ($('ciphChoices2')) $('ciphChoices2').checked = state.encryptChoices;
  }

  function savedSummary() {
    const el = $('ciphData');
    if (!el) return;
    const marks = Object.values(state.bookmarks).reduce((n, b) => n + ((b && b.items && b.items.length) || 0), 0);
    el.innerHTML = '';
    const lines = [
      `${state.ciphers.length} saved cipher${state.ciphers.length === 1 ? '' : 's'}.`,
      `Chapter text is ${state.showEncrypted ? 'shown encrypted' : 'shown readable'} in the reader. Choice labels are ${state.encryptChoices ? 'encrypted' : 'left readable'}.`,
      `${marks} bookmark${marks === 1 ? '' : 's'} in ${Object.keys(state.bookmarks).length} stor${Object.keys(state.bookmarks).length === 1 ? 'y' : 'ies'}.`,
      'The passphrase library is separate: Export in the Library panel downloads that AES backup. This backup is the ciphers, bookmarks, and cipher settings.',
    ];
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line;
      el.appendChild(li);
    }
  }

  function backupObject() {
    return {
      format: 'chyoa-reader-cipher-backup',
      version: 1,
      created: new Date().toISOString(),
      note: 'Ciphers, bookmarks, and cipher settings for Aero Reader. The passphrase library is a separate export.',
      ciphers: state.ciphers,
      selected: state.selected,
      showEncrypted: state.showEncrypted,
      encryptChoices: state.encryptChoices,
      bookmarks: state.bookmarks,
    };
  }

  function restoreObject(data) {
    if (!data || data.format !== 'chyoa-reader-cipher-backup' || !Array.isArray(data.ciphers)) throw new Error("That isn't a cipher backup from this reader.");
    const ciphers = data.ciphers.filter((c) => c && C().isValidKey(c.key) && c.sid && c.name);
    if (!ciphers.length) throw new Error('That backup has no usable ciphers.');
    state.ciphers = ciphers;
    state.selected = ciphers.some((c) => c.sid === data.selected) ? data.selected : ciphers[0].sid;
    state.showEncrypted = data.showEncrypted !== false;
    state.encryptChoices = !!data.encryptChoices;
    state.bookmarks = data.bookmarks && typeof data.bookmarks === 'object' ? data.bookmarks : {};
    persist();
    fillSelects();
    loadDraft(state.selected);
    syncChecks();
    savedSummary();
    onChange();
    refreshChapter();
  }

  function showTab(name) {
    document.querySelectorAll('[data-cpanel]').forEach((p) => p.classList.toggle('hidden', p.dataset.cpanel !== name));
    document.querySelectorAll('[data-ctab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.ctab === name ? 'true' : 'false'));
    if (name === 'saved') savedSummary();
    if (name === 'cipher') { buildGrid(); loadDraft(state.selected); }
  }

  function decryptRaw(raw, key, opts) {
    const text = C().extractPayload(raw) || String(raw || '');
    try {
      if (opts && opts.force) return C().decryptToString(text, key, { force: true });
      return C().decryptToString(text, key);
    } catch (e) {
      if ((e.code || e.message) !== 'FORMATTED') throw e;
      return decryptFormatted(text, key, opts);
    }
  }

  function decryptFormatted(text, key, opts) {
    const h = C().readHeader(text);
    const base = { 3: '1', 4: '2', 6: '5' }[h.version];
    if (!base) throw Object.assign(new Error('VERSION'), { code: 'VERSION' });
    if (h.fp !== C().fingerprint(key) && !(opts && opts.force)) throw Object.assign(new Error('FINGERPRINT'), { code: 'FINGERPRINT', textFp: h.fp });
    const doc = new DOMParser().parseFromString(`<body>${h.body}</body>`, 'text/html');
    const nodes = [];
    const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { if (!n.data.includes('\n')) nodes.push(n.data); }
    const inner = ['AO3SUB', base, h.fp, String(h.len)].join('$') + '\n' + nodes.join('\n');
    return new TextDecoder().decode(C().decodeText(inner, key, { force: true }));
  }

  function keyForDecrypt() {
    const pasted = ($('ciphDecKey') && $('ciphDecKey').value.trim()) || '';
    if (!pasted) return selected().key;
    const key = C().importKey(pasted);
    if (!key) throw Object.assign(new Error('BADKEY'), { code: 'BADKEY' });
    return key;
  }

  function showDecrypted(plain) {
    lastPlain = plain;
    const box = $('ciphDecOut');
    if (box) box.classList.remove('hidden');
    const host = $('ciphDecPreview');
    if (host) {
      host.innerHTML = '';
      for (const b of C().parseStoryText(plain)) {
        let el;
        if (b.type === 'title') el = document.createElement('h1');
        else if (b.type === 'ch') el = document.createElement('h2');
        else if (b.type === 'hr') el = document.createElement('hr');
        else el = document.createElement('p');
        if (b.type !== 'hr') el.textContent = b.type === 'by' ? `by ${b.text}` : b.text;
        host.appendChild(el);
      }
    }
    setStatus('ciphDecStatus', 'Decrypted. The preview below is readable with this cipher.', 'good');
  }

  function openReader(opts) {
    read = opts;
    $('readTitle').textContent = opts.title || '';
    $('readKind').textContent = opts.kind === 'enc' ? 'encrypted' : 'decrypted';
    $('readPaper').innerHTML = opts.html || '';
    let i = 0;
    $('readPaper').querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, pre').forEach((el) => {
      if (!el.textContent.trim()) return;
      el.dataset.i = String(i++);
    });
    markBooks();
    renderBooks();
    $('readMode').classList.remove('hidden');
    document.body.classList.add('reading');
    $('readMode').scrollTop = 0;
  }
  function closeRead() {
    $('readMode').classList.add('hidden');
    document.body.classList.remove('reading');
    read = null;
  }
  function bookId() { return read ? read.id : ''; }
  function bookItems() {
    const b = state.bookmarks[bookId()];
    return (b && b.items) || [];
  }
  function markBooks() {
    const have = new Set(bookItems().map((b) => b.i));
    $('readPaper').querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('booked', have.has(Number(el.dataset.i))));
    if ($('readBmCount')) $('readBmCount').textContent = String(bookItems().length);
  }
  function renderBooks() {
    const list = $('readBms');
    if (!list) return;
    list.innerHTML = '';
    const items = bookItems();
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'No bookmarks yet. Press Bookmark, or click a paragraph.';
      list.appendChild(p);
      return;
    }
    for (const b of items) {
      const row = document.createElement('div');
      row.className = 'bm-row';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn small';
      open.textContent = b.snip || `Paragraph ${b.i + 1}`;
      open.onclick = () => {
        const el = $('readPaper').querySelector(`[data-i="${b.i}"]`);
        if (el) el.scrollIntoView({ block: 'center' });
      };
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn small';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Remove bookmark');
      del.onclick = () => removeBm(b.i);
      row.append(open, del);
      list.appendChild(row);
    }
  }
  function addBm(i) {
    if (!read || !Number.isFinite(i)) return;
    const el = $('readPaper').querySelector(`[data-i="${i}"]`);
    if (!el) return;
    const items = bookItems().filter((b) => b.i !== i);
    items.push({ i, snip: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 80), at: new Date().toISOString() });
    items.sort((a, b) => a.i - b.i);
    state.bookmarks[bookId()] = { title: read.title || '', items };
    persist();
    markBooks();
    renderBooks();
  }
  function removeBm(i) {
    const items = bookItems().filter((b) => b.i !== i);
    if (items.length) state.bookmarks[bookId()] = { title: read.title || '', items };
    else delete state.bookmarks[bookId()];
    persist();
    markBooks();
    renderBooks();
  }
  function toggleBm(i) {
    if (bookItems().some((b) => b.i === i)) removeBm(i);
    else addBm(i);
  }
  function topPara() {
    const list = [...$('readPaper').querySelectorAll('[data-i]')];
    let best = list[0];
    let bestD = Infinity;
    for (const el of list) {
      const top = el.getBoundingClientRect().top;
      const d = Math.abs(top - 80);
      if (top < window.innerHeight && d < bestD) { best = el; bestD = d; }
    }
    return best;
  }
  function nextBm() {
    const items = bookItems();
    if (!items.length) return;
    const y = 90;
    const current = [...$('readPaper').querySelectorAll('[data-i]')].find((el) => el.getBoundingClientRect().top >= y);
    const here = current ? Number(current.dataset.i) : Infinity;
    const nxt = items.find((b) => b.i > here) || items[0];
    const el = $('readPaper').querySelector(`[data-i="${nxt.i}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  }

  function readEncrypted() {
    if (!chapter) return;
    const key = selected().key;
    let html = chapter.html || '';
    if (!chapter.ciphered) {
      try { html = cipherHtml(html, key); } catch { html = `<pre>${C().escHtml(payloadFor(chapter))}</pre>`; }
    }
    openReader({
      title: chapter.chapterTitle || chapter.storyTitle || 'Encrypted chapter',
      html, kind: 'enc', id: `enc:${chapter.url || C().fingerprint(key)}`,
    });
  }
  function readDecrypted() {
    if (!lastPlain) return;
    const host = document.createElement('div');
    for (const b of C().parseStoryText(lastPlain)) {
      let el;
      if (b.type === 'title') el = document.createElement('h1');
      else if (b.type === 'ch') el = document.createElement('h2');
      else if (b.type === 'hr') el = document.createElement('hr');
      else el = document.createElement('p');
      if (b.type !== 'hr') el.textContent = b.type === 'by' ? `by ${b.text}` : b.text;
      host.appendChild(el);
    }
    const title = (C().parseStoryText(lastPlain).find((b) => b.type === 'title') || {}).text || 'Decrypted story';
    openReader({ title, html: host.innerHTML, kind: 'dec', id: `dec:${hash((lastDecKey || '') + lastPlain.slice(0, 180))}` });
  }

  function importParsed(text) {
    const parsed = C().parseCipherFile(text);
    if (parsed.error) throw new Error(parsed.error);
    let n = 0;
    for (const item of parsed.items) {
      if (item.error || !item.key) continue;
      addCipher(item.key, item.name || item.rawName || 'Imported cipher');
      n++;
    }
    if (!n) throw new Error(parsed.items[0] && parsed.items[0].error ? parsed.items[0].error : 'No cipher found in that file.');
    return n;
  }

  // ----- wire -----
  buildGrid();
  fillSelects();
  loadDraft(state.selected);
  syncChecks();
  showTab('enc');

  document.querySelectorAll('[data-ctab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.ctab)));
  $('ciphEncSel').addEventListener('change', () => selectSid($('ciphEncSel').value));
  $('ciphDecSel').addEventListener('change', () => selectSid($('ciphDecSel').value));
  $('cipSel').addEventListener('change', () => selectSid($('cipSel').value));

  const setFlag = (key, on) => { state[key] = !!on; persist(); syncChecks(); onChange(); refreshChapter(); };
  for (const id of ['ciphShow', 'ciphShow2']) if ($(id)) $(id).addEventListener('change', (e) => setFlag('showEncrypted', e.target.checked));
  for (const id of ['ciphChoices', 'ciphChoices2']) if ($(id)) $(id).addEventListener('change', (e) => setFlag('encryptChoices', e.target.checked));

  $('ciphCopy').addEventListener('click', () => copyText($('ciphPayload').value).then(() => toast('Copied the cipher text'), () => toast('Could not copy')));
  $('ciphTxt').addEventListener('click', () => {
    if (!chapter) return;
    const name = C().slugify(chapter.chapterTitle || chapter.storyTitle || 'chapter') + '.cipher.txt';
    download(name, $('ciphPayload').value, 'text/plain;charset=utf-8');
  });
  $('ciphHtml').addEventListener('click', () => {
    if (!chapter) return;
    const page = C().encryptedPage({ title: chapter.chapterTitle || chapter.storyTitle || 'Encrypted chapter', author: chapter.author || '', payload: payloadFor(chapter) });
    download(C().slugify(chapter.chapterTitle || 'chapter') + '.cipher.html', page, 'text/html;charset=utf-8');
  });
  $('ciphRead').addEventListener('click', readEncrypted);
  $('ciphRaw').addEventListener('click', () => {
    const pre = $('ciphPreview'), raw = $('ciphPayload');
    const showRaw = raw.classList.contains('hidden');
    raw.classList.toggle('hidden', !showRaw);
    pre.classList.toggle('hidden', showRaw);
    $('ciphRaw').setAttribute('aria-pressed', showRaw ? 'true' : 'false');
    $('ciphRaw').textContent = showRaw ? 'Show chapter' : 'Show raw text';
  });

  $('ciphDecFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) $('ciphDecText').value = await f.text();
  });
  function runDecrypt(force) {
    setStatus('ciphDecStatus', '');
    try {
      const key = keyForDecrypt();
      lastDecKey = key;
      const plain = decryptRaw($('ciphDecText').value, key, { force });
      showDecrypted(plain);
      if ($('ciphDecWarn')) $('ciphDecWarn').classList.add('hidden');
    } catch (e) {
      if ((e.code || e.message) === 'FINGERPRINT' && !force) {
        setStatus('ciphDecStatus', errText(e), 'bad');
        if ($('ciphDecWarn')) $('ciphDecWarn').classList.remove('hidden');
        return;
      }
      setStatus('ciphDecStatus', errText(e), 'bad');
    }
  }
  $('ciphDecBtn').addEventListener('click', () => runDecrypt(false));
  $('ciphDecForce').addEventListener('click', () => runDecrypt(true));
  $('ciphDecSaveKey').addEventListener('click', () => {
    try {
      if (!$('ciphDecKey').value.trim()) return toast('Paste a cipher key first');
      addCipher(keyForDecrypt(), 'Imported key');
      toast('Cipher saved');
    } catch (e) { setStatus('ciphDecStatus', errText(e), 'bad'); }
  });
  $('ciphDecTxt').addEventListener('click', () => { if (lastPlain) download('story.txt', lastPlain, 'text/plain;charset=utf-8'); });
  $('ciphDecHtml').addEventListener('click', () => { if (lastPlain) download('story.html', C().storyToHtml(lastPlain), 'text/html;charset=utf-8'); });
  $('ciphDecRead').addEventListener('click', readDecrypted);

  $('cipNew').addEventListener('click', () => addCipher(C().shuffleKey(), 'New cipher'));
  $('cipDup').addEventListener('click', () => { const c = selected(); addCipher(c.key, `${c.name} copy`); toast('Duplicated'); });
  $('cipDel').addEventListener('click', () => {
    if (state.ciphers.length < 2) return toast('Keep at least one cipher');
    const c = selected();
    if (!confirm(`Delete “${c.name}”?`)) return;
    state.ciphers = state.ciphers.filter((x) => x.sid !== c.sid);
    state.selected = state.ciphers[0].sid;
    persist();
    fillSelects();
    loadDraft(state.selected);
    onChange();
    refreshChapter();
  });
  $('cipName').addEventListener('input', () => { if ($('cipDirty')) $('cipDirty').textContent = dirty() ? 'Unsaved changes' : ''; });
  $('preJuniper').addEventListener('click', () => applyDraft(C().juniperKey()));
  $('preShuffle').addEventListener('click', () => applyDraft(C().shuffleKey()));
  $('preCaesar').addEventListener('click', () => applyDraft(C().caesarKey(Number($('cipShift').value) || 0)));
  $('preReverse').addEventListener('click', () => applyDraft(C().reverseKey()));
  $('preKeyword').addEventListener('click', () => applyDraft(C().keywordKey($('cipKeyword').value || '')));
  $('preIdentity').addEventListener('click', () => applyDraft(C().ALPHA));
  $('cipSwap').addEventListener('click', () => {
    const a = fromBox($('swapA').value), b = fromBox($('swapB').value);
    const i = C().ALPHA.indexOf(a), j = C().ALPHA.indexOf(b);
    if (i < 0 || j < 0) return setStatus('cipStatus', 'Type one keyboard character in each swap box.', 'bad');
    const t = draft[i]; draft[i] = draft[j]; draft[j] = t;
    paint(true);
  });
  $('cipSave').addEventListener('click', () => {
    const key = draft.join('');
    if (!C().isValidKey(key)) return setStatus('cipStatus', 'Fill every box with one keyboard character before saving.', 'bad');
    const c = selected();
    c.name = ($('cipName').value.trim() || 'Cipher').slice(0, 60);
    c.key = key;
    persist();
    fillSelects();
    loadDraft(c.sid);
    onChange();
    refreshChapter();
    toast('Cipher saved');
  });
  $('cipRevert').addEventListener('click', () => loadDraft(state.selected));
  $('cipCopy').addEventListener('click', () => copyText(C().exportKey(selected().key)).then(() => toast('Cipher key copied'), () => toast('Could not copy')));
  $('cipExport').addEventListener('click', () => {
    const c = selected();
    download(C().slugify(c.name) + '.ao3cipher.json', C().cipherToJson({ name: c.name, key: c.key, created: c.created }), 'application/json');
  });
  $('cipExportAll').addEventListener('click', () => {
    download(`all-ciphers-${new Date().toISOString().slice(0, 10)}.ao3cipher.json`, C().collectionToJson(state.ciphers.map((c) => ({ name: c.name, key: c.key, created: c.created }))), 'application/json');
  });
  async function importFiles(files) {
    try {
      let n = 0;
      for (const f of files) n += importParsed(await f.text());
      setStatus('cipImportMsg', `Imported ${n} cipher${n === 1 ? '' : 's'}.`, 'good');
    } catch (e) { setStatus('cipImportMsg', e.message, 'bad'); }
  }
  $('cipImportFile').addEventListener('change', (e) => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) importFiles(files); });
  $('cipJsonImport').addEventListener('click', () => {
    try { const n = importParsed($('cipJsonIn').value); setStatus('cipImportMsg', `Imported ${n} cipher${n === 1 ? '' : 's'}.`, 'good'); }
    catch (e) { setStatus('cipImportMsg', e.message, 'bad'); }
  });
  $('cipImportKey').addEventListener('click', () => {
    const key = C().importKey($('cipKeyIn').value);
    if (!key) return setStatus('cipImportMsg', ERR.BADKEY, 'bad');
    addCipher(key, 'Imported key');
    $('cipKeyIn').value = '';
    setStatus('cipImportMsg', 'Imported as a new cipher.', 'good');
  });
  const drop = $('ciphDrop');
  if (drop) {
    drop.addEventListener('dragover', (e) => { e.preventDefault(); });
    drop.addEventListener('drop', (e) => { e.preventDefault(); const files = [...(e.dataTransfer.files || [])]; if (files.length) importFiles(files); });
  }

  $('ciphBackup').addEventListener('click', () => {
    const b = backupObject();
    download(`chyoa-reader-ciphers-${b.created.slice(0, 10)}.json`, JSON.stringify(b, null, 2), 'application/json');
    toast('Cipher backup downloaded');
  });
  function restoreText(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
    restoreObject(data);
    toast('Ciphers restored');
    setStatus('ciphDataStatus', 'Restored ciphers, bookmarks, and cipher settings.', 'good');
  }
  $('ciphRestoreFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { restoreText(await f.text()); } catch (err) { setStatus('ciphDataStatus', err.message, 'bad'); }
  });
  $('ciphRestorePaste').addEventListener('click', () => {
    try { restoreText($('ciphRestoreText').value); } catch (err) { setStatus('ciphDataStatus', err.message, 'bad'); }
  });
  $('ciphWipe').addEventListener('click', () => {
    $('ciphWipe').classList.add('hidden');
    $('ciphWipeYes').classList.remove('hidden');
    $('ciphWipeNo').classList.remove('hidden');
    setStatus('ciphDataStatus', 'This erases saved ciphers, bookmarks, the music playlist, and the encrypted library on this device.', 'bad');
  });
  $('ciphWipeNo').addEventListener('click', () => {
    $('ciphWipe').classList.remove('hidden');
    $('ciphWipeYes').classList.add('hidden');
    $('ciphWipeNo').classList.add('hidden');
    setStatus('ciphDataStatus', '');
  });
  $('ciphWipeYes').addEventListener('click', async () => {
    localStorage.removeItem(STORE);
    localStorage.removeItem('cr:player');
    try { await vault.wipe(); } catch { /* library may not exist */ }
    try { await idb.clear('audio'); } catch { /* ignore */ }
    location.reload();
  });

  $('readExit').addEventListener('click', closeRead);
  $('readBm').addEventListener('click', () => { const el = topPara(); if (el) addBm(Number(el.dataset.i)); });
  $('readBmList').addEventListener('click', () => $('readBms').classList.toggle('hidden'));
  $('readPaper').addEventListener('click', (e) => {
    const el = e.target.closest('[data-i]');
    if (el) toggleBm(Number(el.dataset.i));
  });

  function consumeKey(e) {
    if ($('readMode').classList.contains('hidden')) return false;
    if (e.key === 'Escape') { closeRead(); return true; }
    if (e.key === 'j') { $('readMode').scrollBy({ top: innerHeight * 0.45, behavior: 'smooth' }); return true; }
    if (e.key === 'k') { $('readMode').scrollBy({ top: -innerHeight * 0.45, behavior: 'smooth' }); return true; }
    if (e.key === 'b') { nextBm(); return true; }
    return true;
  }

  return {
    present, libraryRecord, payloadFor, refreshChapter,
    onOpen() { fillSelects(); syncChecks(); refreshChapter(); savedSummary(); },
    onChapter(ch) { chapter = ch; refreshChapter(); },
    storyPlain(ch) { if (!ch || ch.ciphered) return null; return C().chapterStoryText(ch, { choices: state.encryptChoices }); },
    decryptText(raw, key, opts) { return decryptRaw(raw, key || selected().key, opts); },
    encryptedHtml(ch) {
      const src = ch || chapter;
      if (!src) return '';
      return C().encryptedPage({ title: src.chapterTitle || src.storyTitle || '', author: src.author || '', payload: payloadFor(src) });
    },
    badge(ch) {
      if (ch && ch.ciphered) return `cipher ${ch.cipherName || ''} ${ch.cipherFp || ''}`.trim();
      if (!state.showEncrypted) return '';
      const c = selected();
      return `cipher ${c.name} · ${C().fingerprint(c.key)}`;
    },
    setShow(on) { setFlag('showEncrypted', on); },
    setChoices(on) { setFlag('encryptChoices', on); },
    useCaesar(n) {
      const shift = ((Math.trunc(Number(n)) % 95) + 95) % 95;
      const key = C().caesarKey(shift);
      const name = `Caesar ${shift}`;
      let c = state.ciphers.find((x) => x.key === key);
      if (!c) c = addCipher(key, name);
      else selectSid(c.sid, { force: true });
      return C().fingerprint(key);
    },
    useJuniper() {
      const key = C().juniperKey();
      let c = state.ciphers.find((x) => x.key === key);
      if (!c) c = addCipher(key, 'Juniper');
      else selectSid(c.sid, { force: true });
      return C().fingerprint(key);
    },
    fp() { return C().fingerprint(selected().key); },
    key: () => selected().key,
    consumeKey,
    closeRead,
    readEncrypted,
    readDecrypted,
  };
}
