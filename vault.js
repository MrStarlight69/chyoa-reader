// Encrypted library: AES-256-GCM, key from PBKDF2-SHA256 (600k iterations) over the user's passphrase.
// Stored in IndexedDB: meta{k:'vault'} = {salt, iter, check}, chapters = [{id, iv, ct}], meta{k:'session'} = {iv, ct}.
import * as idb from './db.js';

export const ITERATIONS = 600000;
const CHECK = 'chyoa-reader-vault-v1';
const te = new TextEncoder(), td = new TextDecoder();
const b64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export function supported() { return !!(window.crypto && crypto.subtle && window.indexedDB); }

async function deriveKey(pass, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(key, obj) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function decrypt(key, rec) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.ct));
  return JSON.parse(td.decode(pt));
}

let key = null;
let meta = null;
const items = new Map(); // id -> plaintext chapter (only while unlocked)
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());
export const onChange = (f) => listeners.add(f);

export async function exists() { meta = meta || (await idb.get('meta', 'vault')); return !!meta; }
export const isUnlocked = () => !!key;
export const list = () => [...items.entries()].map(([id, c]) => ({ id, ...c }));
export const findByUrl = (url) => list().find((c) => c.url === url);

export async function create(pass) {
  const salt = b64(rand(16));
  const k = await deriveKey(pass, salt, ITERATIONS);
  meta = { k: 'vault', v: 1, salt, iter: ITERATIONS, check: await encrypt(k, CHECK), created: new Date().toISOString() };
  await idb.put('meta', meta);
  key = k; items.clear(); emit();
}
export async function unlock(pass) {
  meta = await idb.get('meta', 'vault');
  if (!meta) throw new Error('No library yet.');
  const k = await deriveKey(pass, meta.salt, meta.iter);
  try { if ((await decrypt(k, meta.check)) !== CHECK) throw 0; } catch { throw new Error('Wrong passphrase.'); }
  const recs = await idb.all('chapters');
  items.clear();
  let bad = 0;
  for (const r of recs) { try { items.set(r.id, await decrypt(k, r)); } catch { bad++; } }
  key = k; emit();
  return { count: items.size, bad };
}
export function lock() { key = null; items.clear(); emit(); }

export async function save(ch) {
  if (!key) throw new Error('Library is locked.');
  const existing = findByUrl(ch.url);
  const id = existing ? existing.id : crypto.randomUUID();
  const data = { url: ch.url, storyTitle: ch.storyTitle, storyUrl: ch.storyUrl, storyId: ch.storyId, chapterTitle: ch.chapterTitle, chapterNumber: ch.chapterNumber,
    author: ch.author, authorUrl: ch.authorUrl, arrivedVia: ch.arrivedVia, description: ch.description, html: ch.html, words: ch.words, question: ch.question,
    choices: ch.choices, previousUrl: ch.previousUrl, isStoryPage: ch.isStoryPage, notes: ch.notes, fetchedAt: ch.fetchedAt, savedAt: new Date().toISOString() };
  await idb.put('chapters', { id, ...(await encrypt(key, data)) });
  items.set(id, data); emit();
  return id;
}
export async function remove(id) { await idb.del('chapters', id); items.delete(id); emit(); }
export async function wipe() { await idb.clear('chapters'); await idb.del('meta', 'vault'); await idb.del('meta', 'session'); meta = null; lock(); }

export async function saveSession(obj) { if (key) await idb.put('meta', { k: 'session', ...(await encrypt(key, obj)) }); }
export async function loadSession() { if (!key) return null; const r = await idb.get('meta', 'session'); if (!r) return null; try { return await decrypt(key, r); } catch { return null; } }

// ---- export / import (always ciphertext) ----
export async function exportBlob() {
  const m = await idb.get('meta', 'vault');
  if (!m) throw new Error('Nothing to export yet.');
  const chapters = await idb.all('chapters');
  const session = await idb.get('meta', 'session');
  const out = { format: 'chyoa-reader-vault', version: 1, exportedAt: new Date().toISOString(), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: m.iter, salt: m.salt }, cipher: 'AES-256-GCM', check: m.check, session: session ? { iv: session.iv, ct: session.ct } : null, chapters };
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}
// Returns {mode, added}. askPass(msg) -> Promise<string|null> for foreign vaults.
export async function importFile(file, askPass) {
  let d;
  try { d = JSON.parse(await file.text()); } catch { throw new Error('Not a valid JSON backup.'); }
  if (d.format !== 'chyoa-reader-vault' || !Array.isArray(d.chapters) || !d.kdf || !d.check) throw new Error('Not a CHYOA Reader encrypted backup.');
  const here = await idb.get('meta', 'vault');
  if (!here) { // adopt wholesale
    meta = { k: 'vault', v: 1, salt: d.kdf.salt, iter: d.kdf.iterations, check: d.check, created: d.exportedAt };
    await idb.put('meta', meta);
    await idb.putMany('chapters', d.chapters.map(({ id, iv, ct }) => ({ id, iv, ct })));
    if (d.session) await idb.put('meta', { k: 'session', ...d.session });
    lock();
    return { mode: 'adopted', added: d.chapters.length };
  }
  if (!key) throw new Error('Unlock your library first, then import.');
  let k = key;
  const sameKdf = here.salt === d.kdf.salt && here.iter === d.kdf.iterations;
  if (!sameKdf) {
    const pass = await askPass('This backup was made with a different passphrase. Enter the backup\'s passphrase:');
    if (!pass) return { mode: 'cancelled', added: 0 };
    k = await deriveKey(pass, d.kdf.salt, d.kdf.iterations);
    try { if ((await decrypt(k, d.check)) !== CHECK) throw 0; } catch { throw new Error('Wrong passphrase for that backup.'); }
  }
  let added = 0;
  for (const r of d.chapters) {
    let pt; try { pt = await decrypt(k, r); } catch { continue; }
    if (findByUrl(pt.url)) continue;
    const id = crypto.randomUUID();
    await idb.put('chapters', { id, ...(await encrypt(key, pt)) });
    items.set(id, pt); added++;
  }
  emit();
  return { mode: sameKdf ? 'merged' : 're-encrypted', added };
}
