'use strict';
// Substitution cipher, same rules as MrStarlight69/ao3-fic-encryptor:
// 95 printable ASCII characters, AO3CIPHER$1$ keys, AO3SUB text.
// Wrapped in a block so it can load beside the other classic scripts.
{
const FMT_BASE = { "3": "1", "4": "2", "6": "5" };
const ALPHA = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
// Decrypt preference when several originals share an output: lowercase a-z first, then the rest in keyboard order.
const DEC_ORDER = (() => { const lo = [], rest = []; for (let i = 0; i < 95; i++) (i >= 65 && i <= 90 ? lo : rest).push(i); return lo.concat(rest); })();
// Built-in "Juniper" cipher, modelled on a reference cipher: letters -> symbols, those symbols -> capitals,
// case-insensitive (A-Z share a-z's outputs), digits -> letters, space ? / ~ and the rest unchanged.
const JUNIPER_FROM = "abcdefghijklmnopqrstuvwxyz+[{]}\\|;:'\",.=_-)(*&^%$#@!1234567890";
const JUNIPER_TO   = "+[{]}\\|;:'\",.=_-)(*&^%$#@!ABCDEFGHIJKLMNOPQRSTUVWXYZpickledrso";
function juniperKey(){
  const k = ALPHA.split("");
  for (let j = 0; j < JUNIPER_FROM.length; j++) k[ALPHA.indexOf(JUNIPER_FROM[j])] = JUNIPER_TO[j];
  for (let c = 65; c <= 90; c++) k[c - 32] = k[c - 32 + 32];   // A-Z share a-z's outputs
  return k.join("");
}
const KEY_PREFIX = "AO3CIPHER$1$", TEXT_MAGIC = "AO3SUB", TEXT_VERSION = "1", TEXT_VERSION_SHARED = "2";
const HEXC = new Uint8Array([..."0123456789ABCDEF"].map(c => c.charCodeAt(0)));

function analyzeKey(arr){            // arr: array/string of 95 entries ("" = empty)
  const counts = new Map(); let empty = 0;
  for (let i = 0; i < 95; i++){ const c = arr[i] || ""; if (!c){ empty++; continue; } counts.set(c, (counts.get(c) || 0) + 1); }
  const dups = new Set([...counts].filter(([, n]) => n > 1).map(([c]) => c));
  const missing = [...ALPHA].filter(c => !counts.has(c));
  const bad = [...counts.keys()].filter(c => c.length !== 1 || ALPHA.indexOf(c) < 0);
  let self = 0; for (let i = 0; i < 95; i++) if (arr[i] === ALPHA[i]) self++;
  const ok = arr.length === 95 && !empty && !bad.length;   // shared outputs are allowed
  return { ok, injective: ok && !dups.size, dups, missing, empty, self };
}
function isValidKey(k){ return typeof k === "string" && k.length === 95 && analyzeKey(k).ok; }
function fingerprint(key){           // short ID so decrypt can spot a different cipher; not secret-revealing
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++){ h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return ((h >>> 0) % 2176782336).toString(36).toUpperCase().padStart(6, "0");
}
function exportKey(key){ return KEY_PREFIX + key + "$"; }
function importKey(text){
  const s = String(text || "");
  const at = s.indexOf(KEY_PREFIX);
  if (at < 0) return null;
  const key = s.substr(at + KEY_PREFIX.length, 95);
  if (key.length !== 95 || s[at + KEY_PREFIX.length + 95] !== "$" || !isValidKey(key)) return null;
  return key;
}
function makeMaps(key){
  const enc = new Uint8Array(128), dec = new Uint8Array(128).fill(255);
  for (let i = 0; i < 95; i++) enc[32 + i] = key.charCodeAt(i);
  for (const i of DEC_ORDER){ const c = key.charCodeAt(i); if (dec[c] === 255) dec[c] = 32 + i; }   // first in DEC_ORDER wins
  return { enc, dec };
}
// presets
function shuffleKey(){
  const a = [...ALPHA], r = new Uint32Array(95); crypto.getRandomValues(r);
  for (let i = 94; i > 0; i--){ const j = r[i] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.join("");
}
function caesarKey(n){ n = ((Math.trunc(n) % 95) + 95) % 95; return ALPHA.slice(n) + ALPHA.slice(0, n); }
function reverseKey(){ return [...ALPHA].reverse().join(""); }
function keywordKey(word){
  const seen = new Set(); let out = "";
  for (const c of String(word)) if (ALPHA.includes(c) && !seen.has(c)){ seen.add(c); out += c; }
  for (const c of ALPHA) if (!seen.has(c)) out += c;
  return out;
}

// ---------- cipher .json files ----------
const JSON_NOTE = "Each key is an original character; its value is what it turns into. Values may repeat: when decrypting, a shared value turns back into the first of its characters, with lowercase a-z first and then the rest in keyboard order (the order of this list). Characters left out stay unchanged; if a key is listed twice, the first one counts.";
function cipherJsonLines(c, pre){
  const p = pre + "  ", L = [];
  L.push(pre + "{");
  L.push(`${p}"format": "ao3-cipher",`);
  L.push(`${p}"version": 1,`);
  L.push(`${p}"name": ${JSON.stringify(c.name)},`);
  L.push(`${p}"id": "${fingerprint(c.key)}",`);
  L.push(`${p}"created": ${JSON.stringify(c.created || new Date().toISOString())},`);
  L.push(`${p}"note": ${JSON.stringify(JSON_NOTE)},`);
  L.push(`${p}"key": ${JSON.stringify(exportKey(c.key))},`);
  L.push(`${p}"mapping": {`);
  // written by hand so the order stays keyboard order (JS objects would move "0"-"9" first)
  for (let i = 0; i < 95; i++) L.push(`${p}  ${JSON.stringify(ALPHA[i])}: ${JSON.stringify(c.key[i])}${i < 94 ? "," : ""}`);
  L.push(`${p}}`);
  L.push(pre + "}");
  return L;
}
function cipherToJson(c){ return cipherJsonLines(c, "").join("\n") + "\n"; }
function collectionToJson(list){
  const L = ["{", `  "format": "ao3-cipher-collection",`, `  "version": 1,`, `  "exported": ${JSON.stringify(new Date().toISOString())},`,
    `  "count": ${list.length},`, `  "ciphers": [`];
  list.forEach((c, i) => { const cl = cipherJsonLines(c, "    "); if (i < list.length - 1) cl[cl.length - 1] += ","; L.push(...cl); });
  L.push("  ]", "}");
  return L.join("\n") + "\n";
}
const charList = (arr, max = 24) => arr.slice(0, max).map(c => c === " " ? "space" : c).join("  ") + (arr.length > max ? `  … (+${arr.length - max} more)` : "");
function validateCipherObject(o){
  if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "isn't a cipher (expected an object with a \"mapping\")." };
  if (o.format !== undefined && o.format !== "ao3-cipher") return { error: `has "format": ${JSON.stringify(o.format)}, expected "ao3-cipher".` };
  if (typeof o.version === "number" && o.version > 1) return { error: `uses format version ${o.version}, which is newer than this page understands.` };
  const notes = []; let key = null;
  const nm = c => c === " " ? "space" : c;
  if (o.mapping !== undefined){
    const m = o.mapping;
    if (!m || typeof m !== "object" || Array.isArray(m)) return { error: "has a \"mapping\" that isn't an object like {\"a\": \"q\", …}." };
    const has = k => Object.prototype.hasOwnProperty.call(m, k);
    const badKeys = Object.keys(m).filter(k => k.length !== 1 || !ALPHA.includes(k));
    if (badKeys.length) return { error: `has keys that aren't single keyboard characters: ${badKeys.slice(0, 8).map(k => JSON.stringify(k)).join(", ")}.` };
    const badVals = [...ALPHA].filter(c => has(c) && !(typeof m[c] === "string" && m[c].length === 1 && ALPHA.includes(m[c])));
    if (badVals.length) return { error: `has values that aren't a single keyboard character for: ${charList(badVals)} (e.g. ${JSON.stringify(badVals[0])} → ${JSON.stringify(m[badVals[0]])}).` };
    const dupKeys = JSON_DUPS.get(m) || [];
    for (const d of dupKeys.slice(0, 8)) notes.push(`${JSON.stringify(d.key)} was listed more than once, so the first value ${JSON.stringify(d.kept)} was used (ignored ${JSON.stringify(d.ignored)})`);
    if (dupKeys.length > 8) notes.push(`${dupKeys.length - 8} more repeated keys also kept their first value`);
    const missing = [...ALPHA].filter(c => !has(c));
    if (missing.length) notes.push(`${missing.length} character${missing.length > 1 ? "s weren't" : " wasn't"} listed, so ${missing.length > 1 ? "they stay" : "it stays"} unchanged: ${charList(missing)}`);
    key = [...ALPHA].map(c => has(c) ? m[c] : c).join("");
    if (typeof o.key === "string" && importKey(o.key) !== key) notes.push("its \"key\" field didn't match the mapping, so the mapping was used");
  } else if (typeof o.key === "string"){
    key = importKey(o.key);
    if (!key) return { error: "has no \"mapping\" and its \"key\" isn't a valid cipher key." };
  } else return { error: "has no \"mapping\"." };
  const shared = sharedOutputs(key);
  if (shared.length) notes.push(`${shared.length} output${shared.length > 1 ? "s are" : " is"} shared by several characters, so decrypting gives back the first one (lowercase letters first, then keyboard order): ` +
    shared.slice(0, 6).map(([v, os]) => `${nm(v)} (${os.map(nm).join(", ")} → ${nm(os[0])})`).join("; ") + (shared.length > 6 ? "; …" : ""));
  const id = fingerprint(key);
  if (o.id !== undefined && o.id !== id) notes.push(`the file said ID ${JSON.stringify(o.id)} but this mapping's ID is ${id} (it was probably edited), so ${id} is used`);
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 60) : null;
  const created = typeof o.created === "string" && !isNaN(Date.parse(o.created)) ? o.created : null;
  return { key, id, name, created, notes };
}
function parseCipherFile(text){
  let data;
  const clean = String(text).replace(/^\uFEFF/, "");
  try { JSON.parse(clean); }
  catch (e){ return { error: "isn't valid JSON (" + e.message.replace(/^JSON\.parse: /, "") + ")." }; }
  data = parseJsonFirstWins(clean);
  let list;
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === "object" && Array.isArray(data.ciphers)){
    if (data.format !== undefined && data.format !== "ao3-cipher-collection") return { error: `has "format": ${JSON.stringify(data.format)}, expected "ao3-cipher-collection".` };
    if (typeof data.version === "number" && data.version > 1) return { error: `uses format version ${data.version}, which is newer than this page understands.` };
    list = data.ciphers;
  } else if (data && typeof data === "object") list = [data];
  else return { error: "doesn't look like a cipher file." };
  if (!list.length) return { error: "contains no ciphers." };
  return { collection: list.length > 1 || Array.isArray(data) || Array.isArray(data.ciphers), items: list.map(o => Object.assign(validateCipherObject(o), { rawName: o && typeof o.name === "string" ? o.name.trim().slice(0, 60) : null })) };
}
function slugify(s){ return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "cipher"; }

// ---------- version 2: ciphers where several originals share an output ----------
// The marker M is whatever "~" turns into. Every original whose output is M is
// written as an escape, so M in the text always starts an escape. What follows M
// is written RAW (not substituted), so shared outputs can never scramble it:
//   M ~        -> "~"          M XX       -> byte XX (2 hex digits)
//   M {HEX}    -> code point   newline    -> real newline
// Every other character is substituted. When several originals share an output,
// decrypting gives back the FIRST of them in DEC_ORDER: lowercase a-z first, then
// everything else in keyboard order (space, !, ", … ~). So "a" beats "A" and digits.
// Characters nothing maps to are left as they are when decrypting.
function sharedOutputs(key){          // [[output, [originals…]], …]; each group listed in decrypt-preference order (winner first)
  const by = new Map();
  for (const i of DEC_ORDER){ const v = key[i]; if (!by.has(v)) by.set(v, []); by.get(v).push(ALPHA[i]); }
  return [...by].filter(([, o]) => o.length > 1);
}
function encodeBytesV2(bytes, key){
  const { enc } = makeMaps(key), n = bytes.length, M = enc[126];
  const out = new Uint8Array(n * 9 + 16);   // worst case "M{10FFFF}" for 4 bytes, or "MXX" per byte
  let o = 0;
  const raw = c => { out[o++] = c; };
  for (let i = 0; i < n; ){
    const b = bytes[i];
    if (b === 10){ raw(10); i++; continue; }
    if (b >= 32 && b <= 126){
      if (enc[b] !== M){ raw(enc[b]); i++; continue; }
      raw(M); if (b === 126) raw(126); else { raw(HEXC[b >> 4]); raw(HEXC[b & 15]); }
      i++; continue;
    }
    let len = 0, cp = 0;
    const c1 = bytes[i + 1], c2 = bytes[i + 2], c3 = bytes[i + 3];
    const cont = x => x !== undefined && (x & 0xC0) === 0x80;
    if (b >= 0xC2 && b <= 0xDF && cont(c1)){ len = 2; cp = ((b & 31) << 6) | (c1 & 63); }
    else if (b >= 0xE0 && b <= 0xEF && cont(c1) && cont(c2) && !(b === 0xE0 && c1 < 0xA0) && !(b === 0xED && c1 > 0x9F)){ len = 3; cp = ((b & 15) << 12) | ((c1 & 63) << 6) | (c2 & 63); }
    else if (b >= 0xF0 && b <= 0xF4 && cont(c1) && cont(c2) && cont(c3) && !(b === 0xF0 && c1 < 0x90) && !(b === 0xF4 && c1 > 0x8F)){ len = 4; cp = ((b & 7) << 18) | ((c1 & 63) << 12) | ((c2 & 63) << 6) | (c3 & 63); }
    raw(M);
    if (len){ raw(123); const h = cp.toString(16).toUpperCase(); for (let k = 0; k < h.length; k++) raw(h.charCodeAt(k)); raw(125); i += len; }
    else { raw(HEXC[b >> 4]); raw(HEXC[b & 15]); i++; }
  }
  return new TextDecoder("latin1").decode(out.subarray(0, o));
}
function decodeBodyV2(src, key, len){
  const { enc } = makeMaps(key), M = enc[126], n = src.length;
  const dec = new Uint8Array(128).fill(255);           // first original in DEC_ORDER wins; M is reserved
  for (const i of DEC_ORDER){ const c = enc[32 + i]; if (c !== M && dec[c] === 255) dec[c] = 32 + i; }
  const out = new Uint8Array(Math.max(n, len));
  let o = 0, i = 0;
  const bad = () => cipherError("BADTEXT");
  const nextRaw = () => { while (i < n && src[i] === 13) i++; if (i >= n) throw bad(); const c = src[i++]; if (c > 126) throw cipherError("NONKEY"); return c; };
  const hexv = c => (c >= 48 && c <= 57) ? c - 48 : (c >= 65 && c <= 70) ? c - 55 : (c >= 97 && c <= 102) ? c - 87 : -1;
  while (i < n){
    const c = src[i];
    if (c === 13){ i++; continue; }
    if (c === 10){ out[o++] = 10; i++; continue; }
    if (c > 126) throw cipherError("NONKEY");
    i++;
    if (c !== M){ out[o++] = dec[c] === 255 ? c : dec[c]; continue; }
    const q = nextRaw();
    if (q === 126){ out[o++] = 126; continue; }
    if (q === 123){
      let cp = 0, digits = 0, d;
      while ((d = nextRaw()) !== 125){ const v = hexv(d); if (v < 0 || ++digits > 6) throw bad(); cp = cp * 16 + v; }
      if (!digits || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) throw bad();
      if (cp < 0x80) out[o++] = cp;
      else if (cp < 0x800){ out[o++] = 0xC0 | (cp >> 6); out[o++] = 0x80 | (cp & 63); }
      else if (cp < 0x10000){ out[o++] = 0xE0 | (cp >> 12); out[o++] = 0x80 | ((cp >> 6) & 63); out[o++] = 0x80 | (cp & 63); }
      else { out[o++] = 0xF0 | (cp >> 18); out[o++] = 0x80 | ((cp >> 12) & 63); out[o++] = 0x80 | ((cp >> 6) & 63); out[o++] = 0x80 | (cp & 63); }
      continue;
    }
    const hi = hexv(q), lo = hexv(nextRaw());
    if (hi < 0 || lo < 0) throw bad();
    out[o++] = hi * 16 + lo;
  }
  return { out, o };
}

// Minimal JSON reader for already-valid JSON that keeps the FIRST value of a repeated
// key (JSON.parse keeps the last) and records the repeats.
const JSON_DUPS = new WeakMap();
function parseJsonFirstWins(text){
  let i = 0;
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++; };
  const str = () => { let j = i + 1; while (text[j] !== '"'){ if (text[j] === "\\") j++; j++; } const s = JSON.parse(text.slice(i, j + 1)); i = j + 1; return s; };
  const val = () => {
    ws(); const ch = text[i];
    if (ch === "{"){
      i++; const obj = {}, dups = []; ws();
      if (text[i] === "}"){ i++; return obj; }
      for (;;){
        ws(); const k = str(); ws(); i++; /* : */ const v = val(); ws();
        if (Object.prototype.hasOwnProperty.call(obj, k)) dups.push({ key: k, kept: obj[k], ignored: v });
        else Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
        if (text[i] === ","){ i++; continue; } i++; break;   // "}"
      }
      if (dups.length) JSON_DUPS.set(obj, dups);
      return obj;
    }
    if (ch === "["){ i++; const arr = []; ws(); if (text[i] === "]"){ i++; return arr; } for (;;){ arr.push(val()); ws(); if (text[i] === ","){ i++; continue; } i++; break; } return arr; }
    if (ch === '"') return str();
    const m = /true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y; m.lastIndex = i; const t = m.exec(text)[0]; i += t.length;
    return t === "true" ? true : t === "false" ? false : t === "null" ? null : Number(t);
  };
  return val();
}

// Legacy encoder (format 1/2): no longer used for new texts, kept so old texts can be re-created in tests.
function encodeBytesLegacy(bytes, key){
  if (!analyzeKey(key).injective){
    const text = [TEXT_MAGIC, TEXT_VERSION_SHARED, fingerprint(key), String(bytes.length)].join("$") + "\n" + encodeBytesV2(bytes, key);
    for (let i = 0; i < text.length; i++){ const c = text.charCodeAt(i); if (c !== 10 && (c < 32 || c > 126)) throw new Error("Internal error: non-keyboard character produced"); }
    return text;
  }
  const { enc } = makeMaps(key), n = bytes.length;
  const out = new Uint8Array(n * 3 + 16);   // worst case: 3 output chars per input byte
  let o = 0;
  const put = c => { out[o++] = enc[c]; };
  const putByte = b => { put(126); put(HEXC[b >> 4]); put(HEXC[b & 15]); };
  for (let i = 0; i < n; ){
    const b = bytes[i];
    if (b === 10){ out[o++] = 10; i++; continue; }
    if (b >= 32 && b <= 126){ if (b === 126) put(126); put(b); i++; continue; }
    // try one canonical UTF-8 sequence
    let len = 0, cp = 0;
    const c1 = bytes[i + 1], c2 = bytes[i + 2], c3 = bytes[i + 3];
    const cont = x => x !== undefined && (x & 0xC0) === 0x80;
    if (b >= 0xC2 && b <= 0xDF && cont(c1)){ len = 2; cp = ((b & 31) << 6) | (c1 & 63); }
    else if (b >= 0xE0 && b <= 0xEF && cont(c1) && cont(c2) &&
             !(b === 0xE0 && c1 < 0xA0) && !(b === 0xED && c1 > 0x9F)){ len = 3; cp = ((b & 15) << 12) | ((c1 & 63) << 6) | (c2 & 63); }
    else if (b >= 0xF0 && b <= 0xF4 && cont(c1) && cont(c2) && cont(c3) &&
             !(b === 0xF0 && c1 < 0x90) && !(b === 0xF4 && c1 > 0x8F)){ len = 4; cp = ((b & 7) << 18) | ((c1 & 63) << 12) | ((c2 & 63) << 6) | (c3 & 63); }
    if (len){
      put(126); put(123);
      const h = cp.toString(16).toUpperCase();
      for (let k = 0; k < h.length; k++) put(h.charCodeAt(k));
      put(125); i += len;
    } else { putByte(b); i++; }
  }
  const body = new TextDecoder("latin1").decode(out.subarray(0, o));
  const text = [TEXT_MAGIC, TEXT_VERSION, fingerprint(key), String(n)].join("$") + "\n" + body;
  for (let i = 0; i < text.length; i++){ const c = text.charCodeAt(i); if (c !== 10 && (c < 32 || c > 126)) throw new Error("Internal error: non-keyboard character produced"); }
  return text;
}

// ---------- format version 5 (all ciphers): "blended" escapes ----------
// Versions 1-4 wrote a character with no keyboard equivalent as a visible code such as ~{201C} (in version 2/4,
// the format used by ciphers with shared outputs like Juniper, the code was not even scrambled). Version 5 writes
// it as a marker character M plus 1-5 "digit" characters, all taken from the cipher's own output alphabet, so an
// é or an emoji just looks like a few more cipher letters and still decrypts exactly.
//   M        = the output of one rarely used keyboard character (first good one of ^ ` | \ { } ~ @ # < >),
//              chosen from the cipher itself; any plain character that encrypts to M is escaped too.
//   payload  = the Unicode code point (or 0x110000 + byte for a byte that is not valid UTF-8), big-endian in
//              base 32: every digit but the last is one of 32 "continue" characters, the last one of 32 "final" ones.
//              The 64 digit characters are cipher outputs of common letters first, so they blend in.
//   newline  = kept as a real newline. CR in pasted cipher text is ignored.
const TEXT_VERSION_V5 = "5";
const V5_MARK = "^`|\\{}~@#<>", V5_RARE = new Set("^`|\\{}~@#<>_=+*$%&[]");
const V5_FREQ = "etaoinshrdlucmfwypvbgkjqxzETAOINSHRDLUCMFWYPVBGKJQXZ0123456789.,'\"-!?;:()";
const v5Cache = new Map();
function v5Plan(key){
  let P = v5Cache.get(key); if (P) return P;
  const { enc } = makeMaps(key), groups = new Map();
  for (let i = 0; i < 95; i++){ const o = key.charCodeAt(i); if (!groups.has(o)) groups.set(o, []); groups.get(o).push(ALPHA[i]); }
  let best = null;
  for (const ch of V5_MARK){
    const o = enc[ch.charCodeAt(0)]; if (o === 32) continue;
    const g = groups.get(o), s = (g.every(x => V5_RARE.has(x)) ? 0 : 1000) + g.length;
    if (!best || s < best.s) best = { o, s };
  }
  let M = best ? best.o : 0;
  if (!M){ M = 126; for (let c = 126; c > 32; c--) if (!groups.has(c)){ M = c; break; } }   // every candidate encrypts to a space
  const dec = new Uint8Array(128).fill(255);
  for (const i of DEC_ORDER){ const c = enc[32 + i]; if (c !== M && dec[c] === 255) dec[c] = 32 + i; }
  const seen = new Set([M, 32]), list = [], add = c => { if (!seen.has(c)){ seen.add(c); list.push(c); } };
  for (const ch of V5_FREQ) add(enc[ch.charCodeAt(0)]);
  for (let i = 0; i < 95; i++) add(enc[32 + i]);
  for (let c = 33; c < 127; c++) add(c);
  const fin = new Uint8Array(32), cont = new Uint8Array(32), digit = new Int16Array(128).fill(-1);
  for (let k = 0; k < 32; k++){ fin[k] = list[2 * k]; cont[k] = list[2 * k + 1]; digit[fin[k]] = 32 + k; digit[cont[k]] = k; }
  P = { M, enc, dec, fin, cont, digit };
  if (v5Cache.size > 20) v5Cache.clear();
  v5Cache.set(key, P);
  return P;
}
function encodeBytes(bytes, key, stats){
  const P = v5Plan(key), { enc, M, fin, cont } = P, n = bytes.length;
  const out = new Uint8Array(n * 6 + 16);   // worst case: marker + 5 digits for one byte
  let o = 0, escaped = 0;
  const putVal = v => {
    out[o++] = M;
    let k = 0; const ds = [];
    do { ds.push(v & 31); v = Math.floor(v / 32); } while (v > 0);
    for (k = ds.length - 1; k > 0; k--) out[o++] = cont[ds[k]];
    out[o++] = fin[ds[0]];
  };
  for (let i = 0; i < n; ){
    const b = bytes[i];
    if (b === 10){ out[o++] = 10; i++; continue; }
    if (b >= 32 && b <= 126){ if (enc[b] !== M) out[o++] = enc[b]; else putVal(b); i++; continue; }
    let len = 0, cp = 0;
    const c1 = bytes[i + 1], c2 = bytes[i + 2], c3 = bytes[i + 3];
    const isc = x => x !== undefined && (x & 0xC0) === 0x80;
    if (b < 0x80){ len = 1; cp = b; }
    else if (b >= 0xC2 && b <= 0xDF && isc(c1)){ len = 2; cp = ((b & 31) << 6) | (c1 & 63); }
    else if (b >= 0xE0 && b <= 0xEF && isc(c1) && isc(c2) && !(b === 0xE0 && c1 < 0xA0) && !(b === 0xED && c1 > 0x9F)){ len = 3; cp = ((b & 15) << 12) | ((c1 & 63) << 6) | (c2 & 63); }
    else if (b >= 0xF0 && b <= 0xF4 && isc(c1) && isc(c2) && isc(c3) && !(b === 0xF0 && c1 < 0x90) && !(b === 0xF4 && c1 > 0x8F)){ len = 4; cp = ((b & 7) << 18) | ((c1 & 63) << 12) | ((c2 & 63) << 6) | (c3 & 63); }
    if (len){ putVal(cp); i += len; } else { putVal(0x110000 + b); i++; }
    escaped++;
  }
  if (stats) stats.escaped = (stats.escaped || 0) + escaped;
  const text = [TEXT_MAGIC, TEXT_VERSION_V5, fingerprint(key), String(n)].join("$") + "\n" + new TextDecoder("latin1").decode(out.subarray(0, o));
  for (let i = 0; i < text.length; i++){ const c = text.charCodeAt(i); if (c !== 10 && (c < 32 || c > 126)) throw new Error("Internal error: non-keyboard character produced"); }
  return text;
}
function decodeBodyV5(src, key, len){
  const { M, dec, digit } = v5Plan(key), n = src.length;
  const out = new Uint8Array(Math.max(n, len) + 4);
  let o = 0, i = 0;
  const bad = () => cipherError("BADTEXT");
  while (i < n){
    const c = src[i++];
    if (c === 13) continue;
    if (c === 10){ out[o++] = 10; continue; }
    if (c > 126) throw cipherError("NONKEY");
    if (c !== M){ out[o++] = dec[c] === 255 ? c : dec[c]; continue; }   // characters nothing maps to stay as they are
    let v = 0, nd = 0;
    for (;;){
      while (i < n && src[i] === 13) i++;
      if (i >= n) throw cipherError("INCOMPLETE");   // cut off in the middle of a character
      const d = src[i++]; if (d > 126) throw cipherError("NONKEY");
      const x = digit[d]; if (x < 0 || ++nd > 5) throw bad();
      v = v * 32 + (x & 31);
      if (x >= 32) break;
    }
    if (v >= 0x110000){ if (v > 0x1100FF) throw bad(); out[o++] = v - 0x110000; continue; }
    if (v >= 0xD800 && v <= 0xDFFF) throw bad();
    if (v < 0x80) out[o++] = v;
    else if (v < 0x800){ out[o++] = 0xC0 | (v >> 6); out[o++] = 0x80 | (v & 63); }
    else if (v < 0x10000){ out[o++] = 0xE0 | (v >> 12); out[o++] = 0x80 | ((v >> 6) & 63); out[o++] = 0x80 | (v & 63); }
    else { out[o++] = 0xF0 | (v >> 18); out[o++] = 0x80 | ((v >> 12) & 63); out[o++] = 0x80 | ((v >> 6) & 63); out[o++] = 0x80 | (v & 63); }
    if (o > out.length - 4) throw bad();
  }
  return { out, o };
}

function cipherError(code, extra){ const e = new Error(code); e.code = code; Object.assign(e, extra || {}); return e; }
function readHeader(text){
  const t = String(text).replace(/^\s+/, "");
  const nl = t.indexOf("\n");
  const head = (nl < 0 ? t : t.slice(0, nl)).trim();
  if (head.startsWith("AO3ENC$")) throw cipherError("OLDFORMAT");
  const m = /^AO3SUB\$(\d+)\$([0-9A-Z]{6})\$(\d+)$/.exec(head);
  if (!m) throw cipherError("FORMAT");
  if (!["1", "2", "3", "4", "5", "6"].includes(m[1])) throw cipherError("VERSION");
  return { version: m[1], fp: m[2], len: +m[3], body: nl < 0 ? "" : t.slice(nl + 1) };
}
function decodeText(text, key, opts){
  const h = readHeader(text);
  if (FMT_BASE[h.version]) throw cipherError("FORMATTED");
  if (h.fp !== fingerprint(key) && !(opts && opts.force)) throw cipherError("FINGERPRINT", { textFp: h.fp });
  if (h.version === TEXT_VERSION_V5){
    const { out, o } = decodeBodyV5(new TextEncoder().encode(h.body), key, h.len);
    if (o < h.len) throw cipherError("INCOMPLETE");
    for (let k = h.len; k < o; k++) if (out[k] !== 10) throw cipherError("BADTEXT");
    return out.slice(0, h.len);
  }
  if (h.version === TEXT_VERSION_SHARED){
    const { out, o } = decodeBodyV2(new TextEncoder().encode(h.body), key, h.len);
    if (o < h.len) throw cipherError("INCOMPLETE");
    for (let k = h.len; k < o; k++) if (out[k] !== 10) throw cipherError("BADTEXT");
    return out.slice(0, h.len);
  }
  const { dec } = makeMaps(key);
  const src = new TextEncoder().encode(h.body), n = src.length;
  const out = new Uint8Array(Math.max(n, h.len));
  let o = 0, i = 0;
  const bad = () => cipherError("BADTEXT");
  const next = () => {                       // next substituted char -> plain code (skips CR)
    while (i < n && src[i] === 13) i++;
    if (i >= n) throw bad();
    const c = src[i++]; if (c > 126 || dec[c] === 255) throw cipherError(c > 126 ? "NONKEY" : "BADTEXT");
    return dec[c];
  };
  const hexv = c => (c >= 48 && c <= 57) ? c - 48 : (c >= 65 && c <= 70) ? c - 55 : (c >= 97 && c <= 102) ? c - 87 : -1;
  while (i < n){
    const c = src[i];
    if (c === 13){ i++; continue; }
    if (c === 10){ out[o++] = 10; i++; continue; }
    if (c > 126) throw cipherError("NONKEY");
    const p = next();
    if (p !== 126){ out[o++] = p; continue; }
    const q = next();
    if (q === 126){ out[o++] = 126; continue; }
    if (q === 123){
      let cp = 0, digits = 0, d;
      while ((d = next()) !== 125){ const v = hexv(d); if (v < 0 || ++digits > 6) throw bad(); cp = cp * 16 + v; }
      if (!digits || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) throw bad();
      if (cp < 0x80) out[o++] = cp;
      else if (cp < 0x800){ out[o++] = 0xC0 | (cp >> 6); out[o++] = 0x80 | (cp & 63); }
      else if (cp < 0x10000){ out[o++] = 0xE0 | (cp >> 12); out[o++] = 0x80 | ((cp >> 6) & 63); out[o++] = 0x80 | (cp & 63); }
      else { out[o++] = 0xF0 | (cp >> 18); out[o++] = 0x80 | ((cp >> 12) & 63); out[o++] = 0x80 | ((cp >> 6) & 63); out[o++] = 0x80 | (cp & 63); }
      continue;
    }
    const hi = hexv(q), lo = hexv(next());
    if (hi < 0 || lo < 0) throw bad();
    out[o++] = hi * 16 + lo;
  }
  if (o < h.len) throw cipherError("INCOMPLETE");
  for (let k = h.len; k < o; k++) if (out[k] !== 10) throw bad();   // tolerate extra trailing newlines from copy/paste
  return out.slice(0, h.len);
}
// ---------- story text (same shape as the AO3 encryptor) ----------
// "# Title", "by Author", "## Chapter", "* * *" scene break, then paragraphs.
// A paragraph that could be read as one of those markers is prefixed with "\".
const SCENE = "* * *";
function oneLine(s){ return String(s || "").replace(/\s+/g, " ").trim(); }
function escHtml(s){ return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function decodeEntities(s){
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, n) => {
    if (n[0] === "#"){
      const cp = (n[1] === "x" || n[1] === "X") ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" }[n.toLowerCase()] || m;
  });
}
function storyText(s){
  const out = [];
  if (s.title) out.push("# " + oneLine(s.title));
  if (s.author) out.push("by " + oneLine(s.author));
  for (const c of s.chapters || []){
    if (c.heading) out.push("## " + oneLine(c.heading));
    for (const b of c.blocks || []){
      if (b.type === "hr"){ if (out[out.length - 1] !== SCENE) out.push(SCENE); continue; }
      const text = String(b.text || "");
      out.push(/^(#|\\|by )/.test(text) || text === SCENE ? "\\" + text : text);
    }
  }
  return out.join("\n\n") + "\n";
}
function parseStoryText(text){
  const raw = String(text || "").replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "").split(/\n{2,}/).filter((b) => b !== "");
  const blocks = [];
  raw.forEach((b, i) => {
    if (i === 0 && b.startsWith("# ")) blocks.push({ type: "title", text: b.slice(2) });
    else if (b.startsWith("by ") && (i === 0 || (i === 1 && blocks[0] && blocks[0].type === "title"))) blocks.push({ type: "by", text: b.slice(3) });
    else if (b.startsWith("## ")) blocks.push({ type: "ch", text: b.slice(3) });
    else if (b === SCENE) blocks.push({ type: "hr" });
    else blocks.push({ type: "p", text: b.startsWith("\\") ? b.slice(1) : b });
  });
  return blocks;
}
function blocksFromHtml(html){
  let s = String(html || "");
  s = s.replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, (_, alt) => " " + alt + " ");
  s = s.replace(/<img\b[^>]*>/gi, " ");
  s = s.replace(/<hr\b[^>]*>/gi, "\n\n* * *\n\n");
  s = s.replace(/<br\b[^>]*>/gi, "\n");
  s = s.replace(/<\/(?:p|div|h[1-6]|li|blockquote|pre|tr|table|ul|ol)>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s.split(/\n{2,}/).map((p) => p.replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, " ").trim()).filter(Boolean)
    .map((text) => text === SCENE ? { type: "hr" } : { type: "p", text });
}
function chapterStoryText(ch, opts){
  const o = opts || {};
  const blocks = [];
  if (ch && ch.description) blocks.push({ type: "p", text: oneLine(ch.description) });
  if (ch && ch.arrivedVia) blocks.push({ type: "p", text: oneLine(ch.arrivedVia) });
  blocks.push(...blocksFromHtml(ch && ch.html));
  if (o.choices && ch){
    if (ch.question) blocks.push({ type: "p", text: "? " + oneLine(ch.question) });
    for (const c of ch.choices || []) if (c && c.title) blocks.push({ type: "p", text: "- " + oneLine(c.title) });
  }
  return storyText({ title: (ch && ch.storyTitle) || "", author: (ch && ch.author) || "", chapters: [{ heading: (ch && ch.chapterTitle) || "", blocks }] });
}
function mapChars(str, key){
  let out = "";
  for (const c of String(str || "")){ const i = ALPHA.indexOf(c); out += i >= 0 ? key[i] : c; }
  return out;
}
function storyToHtml(text){
  const blocks = parseStoryText(text);
  const t = blocks.find((b) => b.type === "title"), by = blocks.find((b) => b.type === "by");
  let body = "";
  for (const b of blocks){
    const h = escHtml(b.text || "").replace(/\n/g, "<br>\n");
    if (b.type === "title") body += `<h1>${h}</h1>\n`;
    else if (b.type === "by") body += `<p class="byline">by ${h}</p>\n`;
    else if (b.type === "ch") body += `<h2>${h}</h2>\n`;
    else if (b.type === "hr") body += `<hr>\n`;
    else body += `<p>${h}</p>\n`;
  }
  const title = (t ? t.text : "Story") + (by ? " - " + by.text : "");
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escHtml(title)}</title>\n</head>\n<body>\n${body}</body>\n</html>\n`;
}
function encryptedPage(info){
  const title = info.title || "Encrypted story";
  const author = info.author ? `<p class="byline">by ${escHtml(info.author)}</p>\n` : "";
  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escHtml(title)}</title>\n</head>\n<body>\n<h1>${escHtml(title)}</h1>\n${author}<pre id="cipher">${escHtml(info.payload || "")}</pre>\n</body>\n</html>\n`;
}
function extractPayload(text){
  const s = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const pre = /<pre\b[^>]*\bid=["']cipher["'][^>]*>([\s\S]*?)<\/pre>/i.exec(s);
  if (pre) return decodeEntities(pre[1]);
  const at = s.search(/AO3SUB\$\d+\$[0-9A-Z]{6}\$\d+\n/);
  if (at < 0) return null;
  return s.slice(at);
}
function decryptToString(payload, key, opts){
  const text = extractPayload(payload);
  if (!text) throw cipherError("FORMAT");
  return new TextDecoder().decode(decodeText(text, key, opts));
}

// ---------- AO3 metadata ----------
const api = {
  ALPHA, juniperKey, caesarKey, reverseKey, keywordKey, shuffleKey,
  fingerprint, exportKey, importKey, encodeBytes, decodeText, isValidKey,
  analyzeKey, cipherToJson, collectionToJson, parseCipherFile, readHeader,
  TEXT_MAGIC, KEY_PREFIX, SCENE, storyText, parseStoryText, blocksFromHtml,
  chapterStoryText, mapChars, storyToHtml, encryptedPage, extractPayload,
  decryptToString, escHtml, slugify,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ChyoaCipher = api;
}
