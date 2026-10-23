// Substitution cipher: same AO3SUB / AO3CIPHER rules as ao3-fic-encryptor.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../lib/cipher');
const { parseChapter } = require('../lib/parse');

const te = new TextEncoder();
const td = new TextDecoder();
function roundTrip(key, s) {
  const payload = C.encodeBytes(te.encode(s), key);
  assert.ok(payload.startsWith('AO3SUB$5$'), 'version 5 header');
  assert.strictEqual(td.decode(C.decodeText(payload, key)), s);
  assert.strictEqual(C.decryptToString(payload, key), s);
  return payload;
}

const sample = 'Hello, CHYOA — café 🎄';
const juniper = C.juniperKey();
assert.strictEqual(td.decode(C.decodeText(C.encodeBytes(te.encode(sample), juniper), juniper)), 'hello, chyoa — café 🎄');

for (const key of [C.caesarKey(7), C.caesarKey(0), C.reverseKey(), C.keywordKey('lighthouse'), C.shuffleKey()]) {
  roundTrip(key, sample + '\nSecond line.\n');
}

const html = fs.readFileSync(path.join(__dirname, 'fixture-synthetic.html'), 'utf8');
const ch = parseChapter(html, 'https://chyoa.com/chapter/Second-Door.22');
const story = C.chapterStoryText(ch, { choices: true });
assert.ok(story.startsWith('# Test Story\n\nby tester\n\n## Second Door\n\n'));
assert.ok(story.includes('Which door?'));
assert.ok(story.includes('You open the second door.'));
assert.ok(story.includes('Nested & fine.'));
assert.ok(story.includes('Clean link.'));
assert.ok(story.includes('? What now?'));
assert.ok(story.includes('- Go left'));
assert.ok(!/alert|script/i.test(story));
const withoutChoices = C.chapterStoryText(ch, { choices: false });
assert.ok(!withoutChoices.includes('Go left'));
const payload = roundTrip(C.caesarKey(5), story);
assert.ok(!payload.includes('You open the second door.'));

const swapped = C.ALPHA.split('');
const iA = C.ALPHA.indexOf('A');
const iLt = C.ALPHA.indexOf('<');
[swapped[iA], swapped[iLt]] = [swapped[iLt], swapped[iA]];
const angleKey = swapped.join('');
const angleStory = 'A cat\n';
const anglePayload = roundTrip(angleKey, angleStory);
assert.ok(anglePayload.includes('<'));
const page = C.encryptedPage({ title: 'Test Story', author: 'tester', payload: anglePayload });
assert.ok(page.includes('<h1>Test Story</h1>'));
assert.ok(page.includes('<p class="byline">by tester</p>'));
assert.ok(!page.includes('A cat'));
assert.strictEqual(C.decryptToString(page, angleKey), angleStory);
assert.ok(!page.slice(page.indexOf('<pre')).includes('A cat'));

assert.strictEqual(C.importKey(C.exportKey(angleKey)), angleKey);
assert.throws(() => C.decodeText(payload, C.caesarKey(6)), (e) => e.code === 'FINGERPRINT');
assert.throws(() => C.decryptToString('not cipher text', C.caesarKey(1)), (e) => e.code === 'FORMAT');

const saved = { name: 'Caesar 5', key: C.caesarKey(5), created: '2026-01-01T00:00:00.000Z' };
const parsed = C.parseCipherFile(C.cipherToJson(saved));
assert.strictEqual(parsed.items.length, 1);
assert.strictEqual(parsed.items[0].key, saved.key);
assert.strictEqual(parsed.items[0].name, 'Caesar 5');
const collection = C.parseCipherFile(C.collectionToJson([saved, { name: 'Reverse', key: C.reverseKey(), created: saved.created }]));
assert.strictEqual(collection.items.length, 2);
assert.strictEqual(collection.items[1].key, C.reverseKey());

const plainHtml = C.storyToHtml(story);
assert.ok(plainHtml.includes('<h1>Test Story</h1>'));
assert.ok(plainHtml.includes('<p>You open the second door.</p>'));
assert.strictEqual(C.fingerprint(C.juniperKey()).length, 6);

console.log('cipher tests passed');
