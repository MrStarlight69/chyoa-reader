'use strict';
// Parser for CHYOA chapter/story pages (markup as observed Oct 2026: "rd-story-*" redesign classes).
// Wrapped in a block so this file can be loaded as a classic script next to lib/fetch-proxy.js.
// Zero dependencies: small balanced-tag extractor + allowlist sanitizer.
{
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c' };
function decode(s) {
  if (!s) return '';
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const text = (html) => decode(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// Return inner HTML of the element whose opening tag starts at `start` (balanced on same tag name).
function innerOf(html, start) {
  const open = /^<([a-z0-9]+)/i.exec(html.slice(start, start + 20));
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const openEnd = html.indexOf('>', start);
  if (openEnd < 0) return null;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = openEnd + 1;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(openEnd + 1, m.index);
  }
  return html.slice(openEnd + 1); // unbalanced: best effort
}
function findByClass(html, cls, tag = '[a-z0-9]+', from = 0) {
  const re = new RegExp(`<(${tag})\\b[^>]*class="[^"]*(?:^|\\s|")${cls.replace(/[-]/g, '\\-')}(?:\\s|")[^>]*>`, 'gi');
  re.lastIndex = from;
  const m = re.exec(html);
  return m ? { index: m.index, open: m[0], inner: innerOf(html, m.index) } : null;
}
function classRe(cls) { return new RegExp(`class="(?:[^"]*\\s)?${cls.replace(/-/g, '\\-')}(?:\\s[^"]*)?"`, 'i'); }
function findEl(html, cls, from = 0) {
  const re = /<([a-z0-9]+)\b[^>]*>/gi;
  re.lastIndex = from;
  const cre = classRe(cls);
  let m;
  while ((m = re.exec(html))) {
    if (cre.test(m[0])) return { index: m.index, open: m[0], inner: innerOf(html, m.index) };
  }
  return null;
}

const ALLOWED = new Set(['p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'small', 'big', 'blockquote', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'center', 'font', 'mark']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|form|button|svg|template)\b[\s\S]*?<\/\1\s*>/gi;
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function sanitize(html, notes) {
  let out = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_CONTENT, '');
  out = out.replace(/<(\/?)([a-z0-9]+)\b([^>]*)>/gi, (full, close, name) => {
    name = name.toLowerCase();
    if (!ALLOWED.has(name)) return '';
    if (name === 'font' || name === 'center') name = name === 'center' ? 'div' : 'span';
    if (close) return `</${name}>`;
    if (name === 'a') {
      const href = attr(full, 'href');
      if (href && /^https?:\/\//i.test(href)) return `<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">`;
      return '<a>';
    }
    if (name === 'img') {
      const src = attr(full, 'src');
      const alt = attr(full, 'alt') || '';
      if (!src || !/^https?:\/\//i.test(src)) return '';
      if (/default\.jpg/.test(src) && /log in/i.test(alt)) {
        notes.add('images-login');
        return `<span class="img-placeholder">[image hidden by CHYOA: log-in required]</span>`;
      }
      return `<img src="${escAttr(src)}" alt="${escAttr(alt)}" loading="lazy" referrerpolicy="no-referrer">`;
    }
    if (name === 'br' || name === 'hr') return `<${name}>`;
    return `<${name}>`;
  });
  return out.replace(/(<p>\s*(&nbsp;|\s)*<\/p>\s*){2,}/g, '<p></p>').trim();
}

function canonicalChapterUrl(u) {
  try {
    const url = new URL(u);
    url.hash = ''; url.search = '';
    return url.toString();
  } catch { return u; }
}

class ParseError extends Error { constructor(code, message) { super(message); this.code = code; } }

function parseChapter(html, finalUrl) {
  const notes = new Set();
  const titleTag = text((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1]);
  if (/Chapter unavailable/i.test(titleTag)) {
    const h1 = text((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1]);
    throw new ParseError('NOT_FOUND', `CHYOA says this chapter is unavailable${h1 ? ` ("${h1}")` : ''}. The branch may be unwritten, deleted, or the URL is wrong.`);
  }
  const root = findEl(html, 'rd-story-chapter');
  const proseEl = findEl(html, 'chapter-content', root ? root.index : 0);
  if (!proseEl) {
    if (/\/auth\/login/.test(finalUrl) || /<input[^>]+name="password"/i.test(html)) {
      throw new ParseError('LOGIN_REQUIRED', 'CHYOA redirected to its login page. This chapter is only visible to logged-in members (or it is private/unpublished). This reader does not log in on your behalf.');
    }
    throw new ParseError('MARKUP_CHANGED', 'Could not find the chapter text on the page (no "chapter-content" block). CHYOA may have changed its markup, or this is not a chapter page.');
  }
  const scope = root ? root.inner : html;
  const titleEl = findEl(scope, 'rd-story-reading-title');
  const chapterTitle = text(titleEl && titleEl.inner) || text((/property="og:title" content="([^"]*)"/.exec(html) || [])[1]);
  // On story start pages the subtitle is the story description; on chapters it is the question that led here.
  const subEl = findEl(scope, 'rd-story-reading-subtitle');
  const subIsQuestion = subEl && /rd-story-reading-subtitle--question/.test(subEl.open);
  const bylineEl = findEl(scope, 'rd-story-reading-byline');
  let author = null, authorUrl = null, chapterNumber = null;
  if (bylineEl) {
    const a = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(bylineEl.inner);
    if (a) { authorUrl = decode(a[1]); author = text(a[2]); }
    const n = /Chapter\s+(\d+)/i.exec(text(bylineEl.inner));
    if (n) chapterNumber = Number(n[1]);
  }
  // Story title: "<chapter> - <story> — CHYOA" for chapters, "<story> — CHYOA" for story pages.
  let storyTitle = titleTag.replace(/\s*\u2014\s*CHYOA\s*$/, '').trim();
  const isStoryPage = /\/story\//.test(finalUrl);
  if (!isStoryPage && chapterTitle && storyTitle.startsWith(chapterTitle + ' - ')) storyTitle = storyTitle.slice(chapterTitle.length + 3);
  const qEl = findEl(scope, 'js-story-question') || findEl(html, 'rd-story-question');
  let question = null; const choices = [];
  if (qEl) {
    const h = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(qEl.inner);
    question = h ? text(h[1]) : null;
    const re = /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*rd-story-branch-link\b[^"]*"[^>]*>([\s\S]*?)<\/a>|<a\b[^>]*class="[^"]*rd-story-branch-link\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(qEl.inner))) {
      const href = decode(m[1] || m[3]);
      if (!/chyoa\.com\/chapter\//.test(href)) continue;
      const inner = m[2] || m[4];
      const t = /rd-story-branch-link__text[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
      const idm = /\.(\d+)(?:[/?#]|$)/.exec(href);
      choices.push({ title: text(t ? t[1] : inner), url: canonicalChapterUrl(href), id: idm ? idm[1] : null });
    }
  }
  const nav = findEl(html, 'rd-story-navigation');
  let previousUrl = null, storyUrl = null;
  if (nav) {
    const p = /href="([^"]*\/chapter\/Previous-Chapter\.\d+[^"]*)"/i.exec(nav.inner);
    if (p) previousUrl = decode(p[1]);
    const s = /href="([^"]*\/story\/[^"]+)"/i.exec(nav.inner);
    if (s) storyUrl = decode(s[1]);
  }
  if (!storyUrl && isStoryPage) storyUrl = canonicalChapterUrl(finalUrl);
  const content = sanitize(proseEl.inner, notes);
  const words = text(content).split(/\s+/).filter(Boolean).length;
  if (!words && !/<img/.test(content)) notes.add('empty');
  const storyId = (/data-story-id="(\d+)"/.exec(html) || [])[1] || null;
  const chapterId = (/data-chapter-id="(\d+)"/.exec(html) || [])[1] || null;
  const description = isStoryPage && subEl && !subIsQuestion ? text(subEl.inner) : null;
  return {
    url: canonicalChapterUrl(finalUrl), storyId, chapterId, isStoryPage,
    storyTitle, description, chapterTitle, chapterNumber, author, authorUrl,
    arrivedVia: subIsQuestion ? text(subEl.inner) : null,
    html: content, words, question, choices, previousUrl, storyUrl,
    isEnding: choices.length === 0, notes: [...notes],
  };
}

const api = { parseChapter, sanitize, decode, ParseError, canonicalChapterUrl };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ChyoaParse = api;
}
