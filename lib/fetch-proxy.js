'use strict';
// Shared by the static page (browser) and tests. Node's server.js uses normalizeUrl too.
{
// Default proxies were checked on 2026-10-22 against live public CHYOA Guide pages:
//   https://chyoa.com/story/CHYOA-Guide.6006
//   https://chyoa.com/chapter/Reading-on-CHYOA.323151
// A direct fetch from this environment got Cloudflare's "Just a moment" challenge.
// corsproxy.io now requires an API key. api.allorigins.win and api.codetabs.com timed out.
// The two below returned the chapter HTML with Access-Control-Allow-Origin echoing
// https://mrstarlight69.github.io . cors.dev sometimes still returns a challenge, so it is second.

const DEFAULT_PROXIES = [
  {
    id: 'allorigins.hexlet.app',
    build: (url) => 'https://allorigins.hexlet.app/raw?url=' + encodeURIComponent(url),
  },
  {
    id: 'proxy.cors.dev',
    build: (url) => 'https://proxy.cors.dev/raw?url=' + encodeURIComponent(url),
  },
];

function badUrl(message) {
  const e = new Error(message);
  e.code = 'BAD_URL';
  return e;
}

function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw badUrl('Paste a CHYOA story or chapter URL.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try { u = new URL(s); } catch { throw badUrl('That does not look like a URL.'); }
  if (!/^(www\.)?chyoa\.com$/i.test(u.hostname)) throw badUrl('Only chyoa.com URLs are supported.');
  if (!/^\/(story|chapter)\/[^/]+\.\d+\/?$/.test(u.pathname)) throw badUrl('Expected a URL like https://chyoa.com/story/Name.123 or https://chyoa.com/chapter/Name.456');
  u.protocol = 'https:';
  u.hostname = 'chyoa.com';
  u.hash = '';
  u.search = '';
  return u.toString();
}

// Custom proxy templates: "https://name.workers.dev/?url={url}", a base ending in ? or =,
// or a prefix ending in /. {url} is percent-encoded. A trailing slash appends the raw URL.
function buildCustom(template, url) {
  const t = String(template || '').trim();
  if (!t) return null;
  const enc = encodeURIComponent(url);
  if (t.includes('{url}')) return t.replaceAll('{url}', enc);
  if (/[?&=]$/.test(t)) return t + enc;
  if (t.endsWith('/')) return t + url;
  return t + (t.includes('?') ? '&url=' : '?url=') + enc;
}

// A custom proxy is used alone. Falling through to a public proxy would send the URL there
// after the reader had been told not to.
function proxiesFor(customTemplate) {
  const template = String(customTemplate || '').trim();
  if (template) return [{ id: 'custom', custom: true, build: (url) => buildCustom(template, url) }];
  return DEFAULT_PROXIES.map((p) => ({ id: p.id, custom: false, build: p.build }));
}

function payloadFromProxy(body) {
  const raw = String(body || '').replace(/^\uFEFF/, '');
  const t = raw.trim();
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      if (j && typeof j.contents === 'string') {
        const statusUrl = j.status && (j.status.url || j.status.href);
        return { body: j.contents, finalUrl: typeof statusUrl === 'string' ? statusUrl : null };
      }
    } catch { /* proxy returned HTML or plain text */ }
  }
  return { body: raw, finalUrl: null };
}

function classifyBody(body, status) {
  const text = String(body || '');
  const head = text.slice(0, 12000);
  if (/chapter-content|rd-story-chapter|Chapter unavailable/i.test(text)) return 'chapter';
  if (/\/auth\/login/.test(text) && /name\s*=\s*["']password["']/i.test(text)) return 'chapter';
  if (/Just a moment|cf-chl|challenge-platform|Attention Required|cf-browser-verification/i.test(head)) return 'challenge';
  if (status === 429 || /rate limit/i.test(head)) return 'rate';
  return 'bad';
}

function urlFromSavedHtml(html) {
  const s = String(html || '');
  const links = s.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    if (!/\brel\s*=\s*["']canonical["']/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href && /chyoa\.com/i.test(href[1])) return href[1].replace(/&amp;/g, '&');
  }
  const metas = s.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    if (!/\bproperty\s*=\s*["']og:url["']/i.test(tag) && !/\bproperty\s*=\s*og:url\b/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (content && /chyoa\.com/i.test(content[1])) return content[1].replace(/&amp;/g, '&');
  }
  return null;
}

const api = {
  DEFAULT_PROXIES, normalizeUrl, buildCustom, proxiesFor, payloadFromProxy, classifyBody, urlFromSavedHtml,
  MIN_GAP_MS: 1500,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ChyoaFetch = api;
}
