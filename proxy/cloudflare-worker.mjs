// Tiny CORS proxy for Aero Reader. Paste into a Cloudflare Worker (module syntax).
// It only fetches https://chyoa.com/story/… and /chapter/… pages. It does not log in,
// and it does not forward cookies. Point the reader's custom proxy setting at:
//   https://<your-worker>.workers.dev/?url={url}
//
// Dashboard: Workers & Pages → Create → Start with Hello World → paste this file → Deploy.
// CLI: npx wrangler deploy proxy/cloudflare-worker.mjs   (after `npx wrangler login`)

const UA = 'Mozilla/5.0 (compatible; ChyoaPersonalReader/1.0; single-user reader, low rate)';

function cors(extra) {
  const h = new Headers(extra || {});
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  h.set('Access-Control-Allow-Headers', '*');
  h.set('Access-Control-Expose-Headers', 'X-Final-Url, X-Upstream-Status');
  h.set('Cache-Control', 'no-store');
  return h;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: cors() });
    }
    let target;
    try { target = new URL(request.url).searchParams.get('url'); } catch { target = null; }
    let u;
    try { u = new URL(target || ''); } catch { u = null; }
    if (!u || u.protocol !== 'https:' || !/^(www\.)?chyoa\.com$/i.test(u.hostname) || !/^\/(story|chapter)\//.test(u.pathname)) {
      return new Response('Only https://chyoa.com/story/ and /chapter/ URLs are proxied.', { status: 400, headers: cors() });
    }
    u.protocol = 'https:';
    u.hostname = 'chyoa.com';
    const upstream = await fetch(u.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' },
    });
    const headers = cors({
      'Content-Type': upstream.headers.get('content-type') || 'text/html; charset=utf-8',
      'X-Final-Url': upstream.url,
      'X-Upstream-Status': String(upstream.status),
    });
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: 200, headers });
  },
};
