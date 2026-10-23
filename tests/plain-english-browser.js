// Plain English, Encrypt on the main page, and Reset. Not part of `npm test`.
//   node tests/plain-english-browser.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8803);
const START = process.env.START_URL || 'https://chyoa.com/chapter/Reading-on-CHYOA.323151';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
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
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/api\/health|404/.test(m.text())) errors.push(m.text()); });
  const base = `http://127.0.0.1:${PORT}/chyoa-reader/`;
  await page.goto(base, { waitUntil: 'networkidle0' });

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const view = () => page.evaluate(() => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const ch = window.__reader.state().current;
    const d = document.createElement('div');
    d.innerHTML = (ch && ch.html) || '';
    const label = document.querySelector('#choiceList .choice .t');
    return {
      shown: norm(document.querySelector('#chBody').innerText),
      orig: norm(d.innerText),
      title: ch.chapterTitle || '',
      choice: (ch.choices && ch.choices[0] && ch.choices[0].title) || '',
      label: label ? label.textContent : '',
      show: document.querySelector('#ciphShow').checked,
      preview: norm((document.querySelector('#ciphPreview') || {}).innerText || ''),
    };
  });

  console.log('1. load a live chapter; Plain English is selectable and Juniper stays the default');
  await page.type('#urlInput', START);
  await page.click('#urlForm button');
  await page.waitForSelector('#reader:not(.hidden) #btnReset', { timeout: 45000 });
  const lists = await page.evaluate(() => ['ciphEncSel', 'ciphDecSel', 'cipSel'].map((id) => ({
    id,
    names: [...document.getElementById(id).options].map((o) => o.textContent),
    selected: document.getElementById(id).selectedOptions[0].textContent,
  })));
  for (const list of lists) {
    ok(list.names.some((n) => n.startsWith('Juniper')) && list.names.some((n) => n.startsWith('Plain English')), `${list.id} lists Juniper and Plain English (${list.names.join(' | ')})`);
    ok(list.selected.startsWith('Juniper'), `${list.id} still defaults to Juniper (${list.selected})`);
  }

  console.log('2. Plain English shows the chapter exactly as written');
  await page.click('#btnCipher');
  await page.waitForSelector('#cipher:not(.hidden) #ciphEncrypt');
  await page.select('#ciphEncSel', 'plain-english');
  let v = await view();
  ok(v.shown.length > 40 && v.shown === v.orig, `main page matches the original (${v.shown.length} chars) in “${v.title}”`);
  ok(v.label === v.choice, 'choice label matches the original title');

  console.log('3. Caesar fills the cipher panel, and Encrypt is what changes the main page');
  await page.click('#ciphChoices');
  await page.evaluate(() => window.__reader.setShowEncrypted(false));
  v = await view();
  ok(v.shown === v.orig && !v.show, 'turning the display off leaves Plain English readable');
  await page.evaluate(() => window.__reader.useCaesar(7));
  await page.waitForFunction(() => document.querySelector('#ciphEncSel').selectedOptions[0].textContent.startsWith('Caesar 7'));
  v = await view();
  ok(v.shown === v.orig, 'picking Caesar does not cipher the main page while display is off');
  ok(v.label === v.choice, 'choice label stays readable until Encrypt');
  ok(v.preview.length > 40 && v.preview !== v.orig, 'the cipher panel already shows Caesar text');
  const picked = await page.evaluate(() => ['ciphEncSel', 'ciphDecSel', 'cipSel'].map((id) => document.getElementById(id).selectedOptions[0].textContent));
  ok(picked.every((n) => n.startsWith('Caesar 7')), `Caesar is the selected cipher (${picked.join(', ')})`);
  await page.$eval('#ciphEncrypt', (b) => b.scrollIntoView({ block: 'center' }));
  await page.click('#ciphEncrypt');
  v = await view();
  ok(v.show && v.shown !== v.orig && !v.shown.includes(v.orig.slice(0, 60)), 'Encrypt ciphers the main page');
  ok(v.label !== v.choice && v.label.length > 0, `choice label is ciphered (“${v.label.slice(0, 40)}”)`);

  console.log('4. the next chapter stays ciphered');
  const prevTitle = v.title;
  const prevChoice = v.choice;
  await page.keyboard.press('Escape');
  await page.click('#choiceList .choice');
  await page.waitForFunction((t) => document.querySelector('#chTitle').textContent !== t, { timeout: 45000 }, prevTitle);
  v = await view();
  ok(v.title !== prevTitle, `followed “${prevChoice}” to “${v.title}”`);
  ok(v.shown.length > 20 && v.shown !== v.orig && !v.shown.includes(v.orig.slice(0, 60)), 'the next chapter is still ciphered on the main page');

  console.log('5. Plain English, then Decrypt, both restore the original text');
  await page.click('#btnCipher');
  await page.select('#ciphEncSel', 'plain-english');
  v = await view();
  ok(v.shown === v.orig, `Plain English restores “${v.title}” exactly`);
  await page.evaluate(() => window.__reader.useCaesar(7));
  await page.click('#ciphEncrypt');
  v = await view();
  ok(v.shown !== v.orig, 'Encrypt ciphers the chapter again');
  const payload = await page.evaluate(() => window.__reader.payload());
  await page.click('[data-ctab="dec"]');
  await page.evaluate((text) => { document.getElementById('ciphDecText').value = text; }, payload);
  await page.click('#ciphDecBtn');
  await page.waitForFunction(() => /Decrypted/.test(document.getElementById('ciphDecStatus').textContent || ''));
  v = await view();
  ok(v.shown === v.orig && !v.show, 'Decrypt returns the main page to the original text');

  console.log('6. Reset still clears only the reading session');
  await page.keyboard.press('Escape');
  page.once('dialog', (d) => d.accept());
  await page.click('#btnReset');
  await page.waitForSelector('#welcome:not(.hidden)');
  const after = await page.evaluate(() => ({
    readerHidden: document.querySelector('#reader').classList.contains('hidden'),
    crumbs: document.querySelectorAll('#crumbs button').length,
    names: [...document.querySelectorAll('#ciphEncSel option')].map((o) => o.textContent),
    selected: document.querySelector('#ciphEncSel').selectedOptions[0].textContent,
    current: window.__reader.state().current,
    path: window.__reader.state().path.length,
  }));
  ok(after.readerHidden && after.crumbs === 0 && !after.current && after.path === 0, 'Reset returns to the welcome screen');
  ok(after.names.some((n) => n.startsWith('Juniper')) && after.names.some((n) => n.startsWith('Plain English')) && after.names.some((n) => n.startsWith('Caesar 7')), `Reset keeps Juniper, Plain English, and Caesar (${after.names.join(' | ')})`);
  ok(after.selected.startsWith('Caesar 7'), `Reset does not change the selected cipher (${after.selected})`);
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));

  await browser.close();
  server.close();
  console.log('plain english browser test passed');
})().catch((e) => { console.error(e); process.exit(1); });
