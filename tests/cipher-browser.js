// Headless check under /chyoa-reader/: live chapter via the relay, Caesar round-trip,
// next choice stays on that cipher, themes still paint. Not part of `npm test` (needs Chrome and the network).
//   node tests/cipher-browser.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8799);
const START = process.env.START_URL || 'https://chyoa.com/chapter/Reading-on-CHYOA.323151';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓ ' + m); };

function start() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      let p = decodeURIComponent(u.pathname);
      if (!p.startsWith('/chyoa-reader')) { res.statusCode = 404; return res.end('not found'); }
      p = p.slice('/chyoa-reader'.length) || '/';
      if (p.endsWith('/')) p += 'index.html';
      const file = path.normalize(path.join(ROOT, p));
      if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('no'); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
        res.end(buf);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await start();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\/health|404/.test(m.text())) errors.push('console: ' + m.text()); });
  const base = `http://127.0.0.1:${PORT}/chyoa-reader/`;
  await page.goto(base, { waitUntil: 'networkidle0' });
  ok(await page.evaluate(() => !!(window.__reader && window.ChyoaCipher)), 'page booted under /chyoa-reader/');
  ok(errors.length === 0, 'no startup errors ' + errors.join(' | '));

  console.log('1. load a live chapter with the cipher off, to capture the prose');
  await page.evaluate(() => { window.__reader.setShowEncrypted(false); window.__reader.setEncryptChoices(false); });
  await page.type('#urlInput', START);
  await page.click('#urlForm button');
  await page.waitForSelector('#reader:not(.hidden) .choice', { timeout: 45000 });
  const snippet = await page.evaluate(() => {
    const p = document.querySelector('#chBody p') || document.querySelector('#chBody');
    return (p.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  });
  const title = await page.$eval('#chTitle', (e) => e.textContent);
  const choiceUrl = await page.$eval('#choiceList .choice', (e) => e.dataset.url);
  ok(snippet.length > 20, `readable paragraph (${snippet.length} chars) in “${title}”`);
  ok(/chyoa\.com\/chapter\//.test(choiceUrl), 'choice still has a chapter URL');

  console.log('2. encrypt with Caesar and decrypt back to the same string');
  const fp = await page.evaluate(() => window.__reader.useCaesar(7));
  await page.evaluate(() => window.__reader.setShowEncrypted(true));
  const body = await page.$eval('#chBody', (e) => e.innerText);
  ok(!body.includes(snippet), 'chapter view no longer shows that plaintext');
  const same = await page.evaluate(() => {
    const plain = window.__reader.storyPlain();
    const payload = window.__reader.payload();
    const back = window.__reader.decrypt(payload);
    const pageHtml = window.__reader.encryptedHtml();
    const fromHtml = window.__reader.decrypt(pageHtml);
    return { plain, payload, back, fromHtml, fp: window.__reader.fp(), starts: payload.startsWith('AO3SUB$5$'), titleInPayload: payload.includes('# '), titleOnPage: document.querySelector('#chTitle').textContent };
  });
  ok(same.fp === fp, `cipher id ${fp}`);
  ok(same.starts && same.back === same.plain && same.fromHtml === same.plain, 'decrypt(payload) and decrypt(.html) equal the story text');
  ok(same.plain.replace(/\s+/g, ' ').includes(snippet), 'story text still contains the original paragraph');
  ok(same.titleOnPage === title && !same.payload.startsWith(title), 'title stays on the page and is not prefixed onto the cipher text');

  console.log('3. decrypt tab, reading mode, bookmark');
  await page.click('#btnCipher');
  await page.waitForSelector('#cipher:not(.hidden)');
  await page.click('[data-ctab="dec"]');
  await page.evaluate((payload) => { document.getElementById('ciphDecText').value = payload; }, same.payload);
  await page.click('#ciphDecBtn');
  await page.waitForFunction(() => /Decrypted/.test(document.getElementById('ciphDecStatus').textContent));
  const preview = await page.$eval('#ciphDecPreview', (e) => e.innerText.replace(/\s+/g, ' '));
  ok(preview.includes(snippet), 'decrypt preview shows the original paragraph');
  const readable = await page.$eval('#chBody', (e) => e.innerText.replace(/\s+/g, ' '));
  ok(readable.includes(snippet), 'decrypt returns the chapter on the main page to readable text');
  await page.evaluate(() => window.__reader.setShowEncrypted(true));
  await page.click('#ciphDecRead');
  await page.waitForSelector('#readMode:not(.hidden) [data-i]');
  await page.click('#readPaper [data-i]');
  const marks = await page.$eval('#readBmCount', (e) => e.textContent);
  ok(marks === '1', 'bookmark stored on the decrypted story');
  await page.keyboard.press('Escape');
  ok(await page.$eval('#readMode', (e) => e.classList.contains('hidden')), 'escape leaves reading mode');

  console.log('4. choice labels can be encrypted without breaking the link');
  await page.keyboard.press('Escape');
  const label = await page.evaluate(() => {
    const before = (window.__reader.state().current.choices[0] || {}).title;
    window.__reader.setEncryptChoices(true);
    const shown = document.querySelector('#choiceList .choice .t').textContent;
    const url = document.querySelector('#choiceList .choice').dataset.url;
    const plain = window.__reader.storyPlain();
    return { before, shown, url, inPlain: before && plain.includes(before), hidden: shown !== before };
  });
  ok(label.hidden && label.inPlain, 'choice label is scrambled on screen and present in the cipher text');
  ok(/chyoa\.com\/chapter\//.test(label.url), 'scrambled choice still points at a chapter');

  console.log('5. follow a choice; the next chapter stays on the same cipher');
  const fp2 = await page.evaluate(() => window.__reader.fp());
  await page.click('#choiceList .choice');
  await page.waitForFunction((t) => document.querySelector('#chTitle').textContent !== t, { timeout: 45000 }, title);
  const next = await page.evaluate((prev) => {
    const plain = window.__reader.storyPlain();
    const back = window.__reader.decrypt(window.__reader.payload());
    return { title: document.querySelector('#chTitle').textContent, fp: window.__reader.fp(), match: plain === back && !!plain, body: document.querySelector('#chBody').innerText, prevInBody: document.querySelector('#chBody').innerText.includes(prev) };
  }, snippet);
  ok(next.fp === fp2 && next.match, `next chapter “${next.title}” decrypts with ${next.fp}`);
  ok(!next.prevInBody, 'next chapter view is encrypted too');
  const url2 = await page.$eval('#btnOrig', (e) => e.href);
  ok(url2.replace(/\/$/, '') === choiceUrl.replace(/\/$/, ''), 'followed that choice');

  console.log('6. library stores ciphered html inside the passphrase vault');
  await page.click('#btnLibrary');
  await page.type('#passInput', 'correct horse battery staple');
  await page.type('#passInput2', 'correct horse battery staple');
  await page.click('#unlockBtn');
  await page.waitForFunction(() => window.__reader.state().unlocked, { timeout: 30000 });
  await page.waitForFunction(() => window.__reader.state().saved >= 1, { timeout: 15000 });
  const stored = await page.evaluate(() => {
    const snip = (window.__reader.storyPlain() || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    const html = window.__reader.savedHtml() || '';
    return new Promise((res) => {
      const r = indexedDB.open('chyoa-reader');
      r.onsuccess = () => {
        const q = r.result.transaction('chapters').objectStore('chapters').getAll();
        q.onsuccess = () => {
          const raw = JSON.stringify(q.result);
          res({ snip: snip.length, htmlHas: html.includes(snip), rawHas: raw.includes(snip), shaped: q.result.length >= 1 && q.result.every((row) => row.iv && row.ct && !('html' in row)) });
        };
      };
    });
  });
  ok(stored.snip > 20, 'have plaintext to compare against the vault');
  ok(stored.shaped && !stored.rawHas && !stored.htmlHas, 'saved chapter is ciphered, then AES-wrapped ({id, iv, ct})');

  console.log('7. themes still render');
  await page.keyboard.press('Escape');
  const themes = await page.evaluate(() => window.__reader.THEMES.map((t) => t[0]));
  ok(themes.length === 13, '13 themes');
  for (const t of themes) {
    await page.evaluate((t) => window.__reader.setTheme(t), t);
    const c = await page.evaluate(() => {
      const lum = (rgb) => { const m = rgb.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const body = document.querySelector('#chBody');
      const paper = document.querySelector('#reader');
      const a = lum(getComputedStyle(body).color), b = lum(getComputedStyle(paper).backgroundColor);
      return { theme: document.documentElement.dataset.theme, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
    ok(c.theme === t && c.ratio >= 7, `${t} contrast ${c.ratio.toFixed(1)}:1`);
  }

  ok(errors.length === 0, 'no page errors during the run');
  await browser.close();
  server.close();
  console.log('cipher browser test passed');
})().catch((e) => { console.error(e); process.exit(1); });
