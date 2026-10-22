// Offline checks for proxy URL building and "is this actually a CHYOA page?" classification.
const assert = require('assert');
const { normalizeUrl, buildCustom, proxiesFor, classifyBody, payloadFromProxy, urlFromSavedHtml, DEFAULT_PROXIES } = require('../lib/fetch-proxy');

const chapter = 'https://chyoa.com/chapter/Reading-on-CHYOA.323151';
assert.strictEqual(normalizeUrl('chyoa.com/story/CHYOA-Guide.6006'), 'https://chyoa.com/story/CHYOA-Guide.6006');
assert.strictEqual(normalizeUrl('http://www.chyoa.com/chapter/Reading-on-CHYOA.323151?x=1#y'), chapter);
assert.throws(() => normalizeUrl('https://example.com/story/Nope.1'), (e) => e.code === 'BAD_URL');
assert.throws(() => normalizeUrl('https://chyoa.com/user/someone'), (e) => e.code === 'BAD_URL');

assert.strictEqual(buildCustom('https://reader.example/?url={url}', chapter), 'https://reader.example/?url=' + encodeURIComponent(chapter));
assert.strictEqual(buildCustom('https://reader.example/?url=', chapter), 'https://reader.example/?url=' + encodeURIComponent(chapter));
assert.strictEqual(buildCustom('https://proxy.example/', chapter), 'https://proxy.example/' + chapter);
assert.strictEqual(buildCustom('https://reader.example/fetch', chapter), 'https://reader.example/fetch?url=' + encodeURIComponent(chapter));

const pub = proxiesFor('');
assert.deepStrictEqual(pub.map((p) => p.id), DEFAULT_PROXIES.map((p) => p.id));
assert.strictEqual(pub[0].build(chapter), 'https://allorigins.hexlet.app/raw?url=' + encodeURIComponent(chapter));
assert.strictEqual(pub[1].build(chapter), 'https://proxy.cors.dev/raw?url=' + encodeURIComponent(chapter));
const only = proxiesFor('https://mine.workers.dev/?url={url}');
assert.deepStrictEqual(only.map((p) => p.id), ['custom']);
assert.strictEqual(only[0].build(chapter), 'https://mine.workers.dev/?url=' + encodeURIComponent(chapter));

const page = '<html><div class="chapter-content"><p>Hi</p></div></html>';
assert.strictEqual(classifyBody(page, 200), 'chapter');
assert.strictEqual(classifyBody('<title>Just a moment...</title><script>cf-chl</script>', 403), 'challenge');
assert.strictEqual(classifyBody('{"error":"nope"}', 502), 'bad');
assert.strictEqual(classifyBody('Rate limit exceeded', 429), 'rate');

const wrapped = payloadFromProxy(JSON.stringify({ contents: page, status: { url: chapter, http_code: 200 } }));
assert.strictEqual(wrapped.body, page);
assert.strictEqual(wrapped.finalUrl, chapter);
assert.strictEqual(payloadFromProxy(page).body, page);

assert.strictEqual(urlFromSavedHtml(`<link rel="canonical" href="${chapter}">`), chapter);
assert.strictEqual(urlFromSavedHtml(`<meta property="og:url" content="${chapter}">`), chapter);
assert.strictEqual(urlFromSavedHtml('<html>nope</html>'), null);

console.log('proxy tests passed');
