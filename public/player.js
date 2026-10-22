// Mini music player: user-supplied local files (optionally remembered in IndexedDB) + direct stream URLs.
import * as idb from './db.js';
const $ = (id) => document.getElementById(id);
const LS = 'cr:player';

export function initPlayer(toast) {
  const audio = $('audio'), root = $('player');
  let list = [];          // {id, name, kind:'file'|'url', src, blob?}
  let idx = -1;
  const st = Object.assign({ shuffle: false, repeat: 'all', volume: 0.6, urls: [], last: null }, JSON.parse(localStorage.getItem(LS) || '{}'));
  const persist = () => localStorage.setItem(LS, JSON.stringify({ shuffle: st.shuffle, repeat: st.repeat, volume: st.volume, urls: list.filter((t) => t.kind === 'url').map(({ id, name, src }) => ({ id, name, src })), last: list[idx]?.id || null }));
  audio.volume = st.volume; $('plVol').value = st.volume;
  const fmt = (s) => !isFinite(s) ? 'live' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function render() {
    const ol = $('plList'); ol.innerHTML = '';
    list.forEach((t, i) => {
      const li = document.createElement('li');
      if (i === idx) li.className = 'active';
      li.innerHTML = `<span class="k">${t.kind === 'url' ? '📡' : '🎵'}</span><span class="nm"></span><button title="Remove" aria-label="Remove">✕</button>`;
      li.querySelector('.nm').textContent = t.name;
      li.onclick = (e) => { if (e.target.tagName === 'BUTTON') return removeAt(i); play(i); };
      ol.appendChild(li);
    });
    $('plShuffle').setAttribute('aria-pressed', st.shuffle);
    $('plRepeat').textContent = `🔁 Repeat: ${st.repeat}`;
    $('plTitle').textContent = list[idx]?.name || (list.length ? 'Ready — press play' : 'No music yet');
    if (idx < 0) $('plTime').textContent = list.length ? `${list.length} track${list.length > 1 ? 's' : ''} in playlist` : 'Add files or a stream URL';
  }
  function play(i) {
    if (!list.length) { root.classList.remove('collapsed'); return toast('Add some audio first ♫'); }
    idx = (i + list.length) % list.length;
    const t = list[idx];
    if (t.kind === 'file' && !t.src) t.src = URL.createObjectURL(t.blob);
    audio.src = t.src;
    audio.play().catch((e) => toast(`Can't play "${t.name}": ${e.message}`));
    render(); persist();
  }
  function next(auto) {
    if (!list.length) return;
    if (auto && st.repeat === 'one') return play(idx);
    if (st.shuffle && list.length > 1) { let j; do j = Math.floor(Math.random() * list.length); while (j === idx); return play(j); }
    if (auto && st.repeat === 'off' && idx === list.length - 1) { idx = -1; render(); return; }
    play(idx + 1);
  }
  async function removeAt(i) {
    const [t] = list.splice(i, 1);
    if (t.kind === 'file') { idb.del('audio', t.id).catch(() => {}); if (t.src) URL.revokeObjectURL(t.src); }
    if (i === idx) { audio.pause(); audio.removeAttribute('src'); idx = -1; } else if (i < idx) idx--;
    render(); persist();
  }
  function togglePlay() { if (idx < 0) return play(0); audio.paused ? audio.play() : audio.pause(); }

  audio.addEventListener('play', () => { root.classList.add('playing'); $('plPlay').textContent = '⏸'; });
  audio.addEventListener('pause', () => { root.classList.remove('playing'); $('plPlay').textContent = '▶'; });
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('error', () => { if (idx >= 0) toast(`Could not load "${list[idx].name}" (unsupported format or stream unreachable)`); root.classList.remove('playing'); });
  audio.addEventListener('timeupdate', () => {
    $('plTime').textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
    if (isFinite(audio.duration) && audio.duration > 0) $('plSeek').value = (audio.currentTime / audio.duration) * 1000;
  });
  $('plSeek').addEventListener('input', (e) => { if (isFinite(audio.duration)) audio.currentTime = (e.target.value / 1000) * audio.duration; });
  $('plVol').addEventListener('input', (e) => { audio.volume = st.volume = Number(e.target.value); persist(); });
  $('plPlay').onclick = togglePlay;
  $('plNext').onclick = () => next(false);
  $('plPrev').onclick = () => (audio.currentTime > 3 ? (audio.currentTime = 0) : play(idx - 1));
  $('plShuffle').onclick = () => { st.shuffle = !st.shuffle; render(); persist(); };
  $('plRepeat').onclick = () => { st.repeat = { all: 'one', one: 'off', off: 'all' }[st.repeat]; render(); persist(); };
  $('plToggle').onclick = () => root.classList.toggle('collapsed');
  $('plFiles').addEventListener('change', async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    const remember = $('plRemember').checked;
    for (const f of files) {
      const t = { id: crypto.randomUUID(), name: f.name.replace(/\.[^.]+$/, ''), kind: 'file', blob: f };
      list.push(t);
      if (remember) idb.put('audio', { id: t.id, name: t.name, blob: f, added: Date.now() }).catch(() => toast('Could not store file (storage full?) — it will play this session only'));
    }
    toast(`Added ${files.length} track${files.length === 1 ? '' : 's'}`);
    render(); persist();
  });
  $('plUrlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('plUrl').value.trim();
    if (!/^https?:\/\//i.test(v)) return toast('Enter an http(s) audio URL');
    let name; try { const u = new URL(v); name = decodeURIComponent(u.pathname.split('/').pop() || u.hostname) || u.hostname; } catch { name = v; }
    list.push({ id: crypto.randomUUID(), name: `${name} (${new URL(v).hostname})`, kind: 'url', src: v });
    $('plUrl').value = ''; render(); persist();
    toast('Stream added');
  });

  // Restore: remembered files + saved URLs.
  (async () => {
    try { (await idb.all('audio')).sort((a, b) => a.added - b.added).forEach((r) => list.push({ id: r.id, name: r.name, kind: 'file', blob: r.blob })); } catch {}
    (st.urls || []).forEach((u) => list.push({ ...u, kind: 'url' }));
    render();
  })();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
    navigator.mediaSession.setActionHandler('previoustrack', () => play(idx - 1));
  }
  return { togglePlay, toggleOpen: () => root.classList.toggle('collapsed') };
}
