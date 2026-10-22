// Minimal IndexedDB helper.
const DB_NAME = 'chyoa-reader';
let dbp;
export function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
      if (!d.objectStoreNames.contains('chapters')) d.createObjectStore('chapters', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const get = (store, key) => tx(store, 'readonly', (s) => req(s.get(key)));
export const all = (store) => tx(store, 'readonly', (s) => req(s.getAll()));
export const put = (store, val) => tx(store, 'readwrite', (s) => { s.put(val); });
export const putMany = (store, vals) => tx(store, 'readwrite', (s) => { vals.forEach((v) => s.put(v)); });
export const del = (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); });
export const clear = (store) => tx(store, 'readwrite', (s) => { s.clear(); });
