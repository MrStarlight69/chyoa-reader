// Reset clears the reading session only. Not part of `npm test` (needs Chrome and the network).
//   node tests/reset-browser.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8801);
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

  console.log('1. load a chapter and follow a choice');
  await page.evaluate(() => window.__reader.setTheme('dreamcore'));
  await page.type('#urlInput', START);
  await page.click('#urlForm button');
  await page.waitForSelector('#reader:not(.hidden) #btnReset', { timeout: 45000 });
  const title = await page.$eval('#chTitle', (e) => e.textContent);
  await page.click('#choiceList .choice');
  await page.waitForFunction((t) => document.querySelector('#chTitle').textContent !== t, { timeout: 45000 }, title);
  const crumbs = await page.$$eval('#crumbs button', (b) => b.map((x) => x.textContent));
  ok(crumbs.length === 2, `path has two chapters (${crumbs.join(' › ')})`);
  ok(await page.$eval('#btnReset', (e) => e.textContent === 'Reset' && !e.classList.contains('hidden')), 'Reset sits in the chapter actions');

  console.log('2. keep a library, a cipher, a theme, and a playlist');
  await page.click('#plToggle');
  await page.type('#plUrl', 'https://example.org/stream/radio.mp3');
  await page.click('#plUrlForm button');
  await page.click('#btnLibrary');
  await page.type('#passInput', 'correct horse battery staple');
  await page.type('#passInput2', 'correct horse battery staple');
  await page.click('#unlockBtn');
  await page.waitForFunction(() => window.__reader.state().unlocked && window.__reader.state().saved >= 1, { timeout: 30000 });
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => ({
    fp: window.__reader.fp(),
    theme: document.documentElement.dataset.theme,
    saved: window.__reader.state().saved,
    ciphers: localStorage.getItem('cr:ciphers'),
    prefs: localStorage.getItem('cr:prefs'),
    themeKey: localStorage.getItem('cr:theme'),
    player: localStorage.getItem('cr:player'),
    tracks: document.querySelectorAll('#plList li').length,
  }));
  ok(before.saved >= 1 && before.tracks >= 1 && before.fp && before.theme === 'dreamcore', 'library, cipher, theme, and playlist are in place');

  console.log('3. cancel leaves the chapter up');
  page.once('dialog', (d) => d.dismiss());
  await page.click('#btnReset');
  await page.waitForFunction(() => document.querySelector('#reader') && !document.querySelector('#reader').classList.contains('hidden'));
  ok((await page.$$eval('#crumbs button', (b) => b.length)) === 2, 'dismissing the confirm keeps the path');

  console.log('4. confirm returns to the start screen');
  page.once('dialog', async (d) => {
    if (d.message().includes('library') && d.type() === 'confirm') await d.accept();
    else await d.dismiss();
  });
  await page.click('#btnReset');
  await page.waitForSelector('#welcome:not(.hidden)');
  const after = await page.evaluate(() => ({
    readerHidden: document.querySelector('#reader').classList.contains('hidden'),
    crumbs: document.querySelectorAll('#crumbs button').length,
    crumbsHidden: document.querySelector('#crumbs').classList.contains('hidden'),
    url: document.querySelector('#urlInput').value,
    hash: location.hash,
    search: location.search,
    title: document.title,
    state: window.__reader.state(),
    fp: window.__reader.fp(),
    theme: document.documentElement.dataset.theme,
    ciphers: localStorage.getItem('cr:ciphers'),
    prefs: localStorage.getItem('cr:prefs'),
    themeKey: localStorage.getItem('cr:theme'),
    player: localStorage.getItem('cr:player'),
    tracks: document.querySelectorAll('#plList li').length,
    audioPaused: document.querySelector('#audio').paused,
  }));
  ok(after.readerHidden && after.crumbs === 0 && after.crumbsHidden, 'welcome screen, empty breadcrumb');
  ok(after.url === '' && after.hash === '' && after.search === '', 'URL box, hash, and query are clear');
  ok(!after.state.current && after.state.path.length === 0 && after.state.pos < 0 && after.state.prefetched.length === 0, 'chapter, path, and prefetch cache are clear');
  ok(after.title === 'Aero Reader · CHYOA', 'title is the start-screen title');
  ok(after.state.unlocked && after.state.saved === before.saved, `library still unlocked with ${after.state.saved} chapter(s)`);
  ok(after.fp === before.fp && after.ciphers === before.ciphers, 'saved ciphers are untouched');
  ok(after.theme === 'dreamcore' && after.prefs === before.prefs && after.themeKey === before.themeKey, 'theme and reader settings are untouched');
  ok(after.tracks === before.tracks && after.player === before.player, 'music playlist is untouched');
  ok(errors.length === 0, 'no page errors');
  await browser.close();
  server.close();
  console.log('reset browser test passed');
})().catch((e) => { console.error(e); process.exit(1); });
