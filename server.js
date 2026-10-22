'use strict';
// CHYOA Reader — tiny zero-dependency backend (Node >= 18).
// Serves ./public and exposes GET /api/chapter?url=<chyoa url> -> clean JSON.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseChapter, ParseError } = require('./lib/parse');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MIN_GAP_MS = Number(process.env.MIN_GAP_MS || 1500);   // politeness delay between upstream requests
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30 * 60 * 1000);
const CACHE_MAX = 300;
const UA = process.env.READER_UA || 'Mozilla/5.0 (compatible; ChyoaPersonalReader/1.0; single-user reader, low rate)';
const PUBLIC = path.join(__dirname, 'public');

// ---- in-memory cache only (chapter text is never written to disk in plaintext) ----
const cache = new Map();
function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.t > CACHE_TTL_MS) { cache.delete(k); return null; }
  cache.delete(k); cache.set(k, e); // LRU bump
  return e.v;
}
function cacheSet(k, v) {
  cache.set(k, { t: Date.now(), v });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// ---- serialized, rate-limited upstream queue ----
let chain = Promise.resolve();
let lastFetch = 0;
const inflight = new Map();
let upstreamCount = 0;
function politeFetch(url) {
  if (inflight.has(url)) return inflight.get(url);
  const p = (chain = chain.then(async () => {
    const wait = lastFetch + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetch = Date.now();
    upstreamCount++;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, {
        redirect: 'follow', signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' },
      });
      const body = await res.text();
      return { status: res.status, finalUrl: res.url, headers: Object.fromEntries(res.headers), body };
    } finally { clearTimeout(to); }
  }).catch((e) => ({ error: e }))).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new ParseError('BAD_URL', 'Paste a CHYOA story or chapter URL.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try { u = new URL(s); } catch { throw new ParseError('BAD_URL', 'That does not look like a URL.'); }
  if (!/^(www\.)?chyoa\.com$/i.test(u.hostname)) throw new ParseError('BAD_URL', 'Only chyoa.com URLs are supported.');
  if (!/^\/(story|chapter)\/[^/]+\.\d+\/?$/.test(u.pathname)) throw new ParseError('BAD_URL', 'Expected a URL like https://chyoa.com/story/Name.123 or https://chyoa.com/chapter/Name.456');
  u.protocol = 'https:'; u.hostname = 'chyoa.com'; u.hash = ''; u.search = '';
  return u.toString();
}

function classifyBlock(r) {
  const h = r.headers || {};
  const b = r.body || '';
  const cf = /cloudflare/i.test(h.server || '') || h['cf-ray'];
  if ((r.status === 403 || r.status === 503 || r.status === 429) && (cf || /cf-chl|Just a moment|Attention Required|challenge-platform/i.test(b))) {
    return new ParseError('BLOCKED', `CHYOA's CDN (Cloudflare) returned HTTP ${r.status} with a bot challenge to the server-side fetch. Open the chapter in your normal browser, or retry later.`);
  }
  if (r.status === 429) return new ParseError('RATE_LIMITED', 'CHYOA returned HTTP 429 (too many requests). Wait a minute and try again.');
  if (r.status === 404 || r.status === 410) return null; // parser explains the friendly 404 page
  if (r.status >= 400) return new ParseError('UPSTREAM', `CHYOA returned HTTP ${r.status}.`);
  return null;
}

async function getChapter(url) {
  const hit = cacheGet(url);
  if (hit) return { ...hit, cached: true };
  const r = await politeFetch(url);
  if (r.error) throw new ParseError('NETWORK', `Could not reach chyoa.com: ${r.error.name === 'AbortError' ? 'timed out after 20 s' : r.error.message}`);
  const blocked = classifyBlock(r);
  if (blocked) throw blocked;
  let data;
  try { data = parseChapter(r.body, r.finalUrl || url); }
  catch (e) {
    if (e.code === 'MARKUP_CHANGED' && r.status === 404) throw new ParseError('NOT_FOUND', 'CHYOA returned 404 Not Found for this URL.');
    throw e;
  }
  data.fetchedAt = new Date().toISOString();
  data.requestedUrl = url;
  cacheSet(url, data);
  if (data.url !== url) cacheSet(data.url, data);
  return { ...data, cached: false };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; media-src 'self' blob: data: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SEC_HEADERS });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const STATUS = { BAD_URL: 400, NOT_FOUND: 404, LOGIN_REQUIRED: 403, BLOCKED: 502, RATE_LIMITED: 429, UPSTREAM: 502, NETWORK: 504, MARKUP_CHANGED: 422 };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/chapter') {
      const url = normalizeUrl(u.searchParams.get('url'));
      const data = await getChapter(url);
      return send(res, 200, { ok: true, chapter: data });
    }
    if (u.pathname === '/api/health') return send(res, 200, { ok: true, cache: cache.size, upstreamRequests: upstreamCount, minGapMs: MIN_GAP_MS });
    // static
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC_HEADERS });
      res.end(buf);
    });
  } catch (e) {
    const code = e.code || 'INTERNAL';
    if (!e.code) console.error(e);
    send(res, STATUS[code] || 500, { ok: false, code, error: e.message || String(e) });
  }
});
server.listen(PORT, HOST, () => console.log(`CHYOA Reader running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (polite gap ${MIN_GAP_MS} ms)`));
