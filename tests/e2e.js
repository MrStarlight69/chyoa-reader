// End-to-end test: real chapter -> follow a choice -> encrypted save -> lock/unlock -> every theme -> screenshots.
// Usage: npm start (in another shell), then: npm i -D puppeteer-core && CHROME=/usr/bin/google-chrome npm run e2e
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const START = process.env.START_URL || 'https://chyoa.com/story/CHYOA-Guide.6006';
const SHOTS = path.join(__dirname, '..', 'screenshots');
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓ ' + m); };

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  const errors = []; global.__errors = errors; global.__page = page;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(SHOTS, '00-welcome-frutiger-aero.png') });

  console.log('1. load real chapter');
  await page.type('#urlInput', START);
  await page.click('#urlForm button');
  await page.waitForSelector('#reader:not(.hidden) .choice', { timeout: 30000 });
  const t1 = await page.$eval('#chTitle', (e) => e.textContent);
  const nChoices = await page.$$eval('.choice', (e) => e.length);
  const words = await page.$eval('#chBody', (e) => e.innerText.split(/\s+/).length);
  ok(t1 && words > 50, `rendered "${t1}" (${words} words)`);
  ok(nChoices > 0, `${nChoices} choices shown`);

  console.log('2. prefetch');
  await page.waitForFunction(() => document.querySelectorAll('.choice .st').length && [...document.querySelectorAll('.choice .st')].some((s) => s.textContent.includes('ready')), { timeout: 30000 });
  ok(true, 'at least one next chapter prefetched (⚡ ready)');

  console.log('3. create encrypted library & save');
  await page.click('#btnLibrary');
  await page.type('#passInput', 'correct horse battery staple');
  await page.type('#passInput2', 'correct horse battery staple');
  await page.click('#unlockBtn');
  await page.waitForFunction(() => window.__reader.state().unlocked, { timeout: 30000 });
  await page.waitForFunction(() => window.__reader.state().saved >= 1, { timeout: 10000 });
  ok(true, 'library created and current chapter auto-saved');
  await page.keyboard.press('Escape');

  console.log('4. follow a choice (keyboard "2")');
  const choiceTitle = await page.$eval('.choice:nth-child(1), #choiceList li:nth-child(2) .choice .t', (e) => e.textContent);
  await page.keyboard.press('2');
  await page.waitForFunction((t) => document.querySelector('#chTitle').textContent !== t, { timeout: 30000 }, t1);
  const t2 = await page.$eval('#chTitle', (e) => e.textContent);
  const crumbs = await page.$$eval('#crumbs button', (b) => b.map((x) => x.textContent));
  ok(crumbs.length === 2, `followed to "${t2}", breadcrumb: ${crumbs.join(' › ')}`);
  await page.waitForFunction(() => window.__reader.state().saved >= 2, { timeout: 10000 });
  ok(true, 'second chapter auto-saved encrypted');

  console.log('5. ciphertext at rest');
  const raw = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('chyoa-reader'); r.onsuccess = () => { const q = r.result.transaction('chapters').objectStore('chapters').getAll(); q.onsuccess = () => res(q.result); }; }));
  ok(raw.length >= 2 && raw.every((r) => r.iv && r.ct && !('html' in r) && !('url' in r)), `${raw.length} IndexedDB records contain only {id, iv, ct}`);
  ok(!JSON.stringify(raw).includes(t2), 'chapter title not present in stored bytes');

  console.log('6. lock / wrong pass / unlock');
  await page.click('#btnLock');
  ok(await page.evaluate(() => !window.__reader.state().unlocked), 'locked; decrypted items purged from memory');
  await page.click('#btnLibrary');
  await page.type('#passInput', 'wrong passphrase');
  await page.click('#unlockBtn');
  await page.waitForFunction(() => document.querySelector('#libErr').textContent.length > 0, { timeout: 30000 });
  ok((await page.$eval('#libErr', (e) => e.textContent)).includes('Wrong'), 'wrong passphrase rejected');
  await page.click('#passInput', { clickCount: 3 });
  await page.type('#passInput', 'correct horse battery staple');
  await page.click('#unlockBtn');
  await page.waitForFunction(() => window.__reader.state().unlocked, { timeout: 30000 });
  const n = await page.$$eval('.lib-item', (e) => e.length);
  ok(n >= 2, `unlocked; library lists ${n} chapters`);
  await page.screenshot({ path: path.join(SHOTS, 'z1-library-unlocked.png') });

  console.log('7. export');
  const exported = await page.evaluate(async () => { const m = await import('/vault.js'); return (await m.exportBlob()).text(); });
  const ex = JSON.parse(exported);
  ok(ex.format === 'chyoa-reader-vault' && ex.chapters.length >= 2 && !exported.includes(t2), `export is ciphertext only (${ex.chapters.length} records, PBKDF2 ${ex.kdf.iterations})`);
  await page.keyboard.press('Escape');

  console.log('8. error handling');
  await page.evaluate(() => window.__reader.load('https://chyoa.com/chapter/Nope.999999999', 'push'));
  await page.waitForSelector('#error:not(.hidden)', { timeout: 30000 });
  ok((await page.$eval('#error h2', (e) => e.textContent)).includes('not found'), 'unwritten branch → "Chapter not found" message');
  await page.screenshot({ path: path.join(SHOTS, 'z2-error-not-found.png') });
  await page.click('#errBack');

  console.log('9. every theme');
  const themes = await page.evaluate(() => window.__reader.THEMES.map((t) => t[0]));
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const [i, t] of themes.entries()) {
    await page.evaluate((t) => window.__reader.setTheme(t), t);
    await new Promise((r) => setTimeout(r, 350));
    const c = await page.evaluate(() => {
      const lum = (rgb) => { const m = rgb.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const body = document.querySelector('#chBody'), paper = document.querySelector('#reader');
      const fg = getComputedStyle(body).color, bg = getComputedStyle(paper).backgroundColor;
      const a = lum(fg), b = lum(bg); return { fg, bg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), theme: document.documentElement.dataset.theme };
    });
    ok(c.theme === t && c.ratio >= 7, `${t}: text contrast ${c.ratio.toFixed(1)}:1 (fg ${c.fg} on ${c.bg})`);
    await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, `${String(i + 1).padStart(2, '0')}-${t}.png`) });
    if (['frutiger-aero', 'frutiger-evil', 'y2k-futurism', 'dreamcore'].includes(t)) {
      await page.evaluate(() => document.getElementById('choices').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await new Promise((r) => setTimeout(r, 200));
      await page.screenshot({ path: path.join(SHOTS, `${String(i + 1).padStart(2, '0')}-${t}-choices.png`) });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    }
  }

  console.log('10. music player UI');
  await page.click('#plToggle');
  await page.evaluate(() => window.__reader.setTheme('frutiger-aero'));
  await page.type('#plUrl', 'https://example.org/stream/radio.mp3');
  await page.click('#plUrlForm button');
  ok((await page.$$eval('#plList li', (e) => e.length)) >= 1, 'stream URL added to playlist (persisted to localStorage)');
  await page.screenshot({ path: path.join(SHOTS, 'z3-player-open.png') });

  ok(errors.filter((e) => !/Failed to load resource|example\.org|net::ERR/.test(e)).length === 0, 'no JS errors' + (errors.length ? ` (ignored: ${errors.join(' | ')})` : ''));
  await browser.close();
  console.log('\nALL E2E CHECKS PASSED');
})().catch(async (e) => { console.error(e); console.error('page errors:', global.__errors); try { await global.__page.screenshot({ path: path.join(SHOTS, 'FAILURE.png') }); console.error(await global.__page.evaluate(() => ({ libErr: document.querySelector('#libErr').textContent, btn: document.querySelector('#unlockBtn').textContent }))); } catch {} process.exit(1); });
