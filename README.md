# Aero Reader for CHYOA

A personal, distraction-free reader for [CHYOA](https://chyoa.com) interactive stories. It has an encrypted local library, 13 themes, and a music player.

The same files are a static site. Nothing to install:

**https://mrstarlight69.github.io/chyoa-reader/**

GitHub Pages serves this repository from `main` (there is a `.nojekyll` file, same idea as [ao3-fic-encryptor](https://github.com/MrStarlight69/ao3-fic-encryptor)). Asset links are relative, so they work under the `/chyoa-reader/` subpath.

## Why a proxy

Pages cannot run `server.js`, and a browser page on `github.io` cannot `fetch` chyoa.com itself: CHYOA does not send `Access-Control-Allow-Origin`. The reader parses the chapter in your browser (the same parser as `lib/parse.js`) and asks a CORS proxy to download the HTML.

On 22 Oct 2026 these were requested with `Origin: https://mrstarlight69.github.io` against the public pages `https://chyoa.com/story/CHYOA-Guide.6006` and `https://chyoa.com/chapter/Reading-on-CHYOA.323151`:

| Proxy | Result |
|---|---|
| Direct `https://chyoa.com/…` | Cloudflare "Just a moment" challenge (HTTP 403). A browser on Pages is also blocked by CORS even when Cloudflare lets the request through. |
| `https://allorigins.hexlet.app/raw?url=` | Worked repeatedly. HTTP 200, chapter HTML, `Access-Control-Allow-Origin` echoed the Pages origin. **This is the default.** |
| `https://proxy.cors.dev/raw?url=` | Worked some of the time (real chapter HTML and the same CORS header) and some of the time returned Cloudflare's challenge. **Automatic fallback.** Its free tier also caps a response at about 1 MiB. |
| `https://corsproxy.io/` | No. Anonymous legacy URLs now require an API key. |
| `https://api.allorigins.win/raw?url=` and `https://api.codetabs.com/v1/proxy` | Timed out. |
| `https://corsproxy.org/`, `https://cors.isomorphic-git.org/`, `https://thingproxy.freeboard.io/`, `https://cors.eu.org/`, `https://api.cors.lol/` | Dead, challenged, rate-limited, or not CORS-readable. |

If the first proxy fails, the next one is tried. Requests are one at a time, at least 1.5 seconds apart. A proxy that returns a real CHYOA page (including "chapter unavailable" or a login page) is not retried: that answer is shown as-is.

**Privacy.** A public proxy sees the chapter URL you request, the way a website sees a visitor. It does not see your passphrase or the encrypted library. Do not use a public proxy for anything you would not want that operator to know you opened. Set a custom proxy and the reader stops calling the public ones.

**Saved HTML.** If every proxy fails, open the chapter in your normal browser, use Save Page → **HTML only** (not "Webpage, complete"), and press **HTML** in the reader. A real CHYOA save includes a canonical URL. If it does not, paste the chapter URL first, then open the file.

## Your own Cloudflare proxy

`proxy/cloudflare-worker.mjs` is a short Worker. It only fetches `https://chyoa.com/story/…` and `/chapter/…`, follows redirects, and adds CORS headers. It does not log in and it does not forward cookies.

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Start with Hello World**.
2. Replace the sample with the contents of `proxy/cloudflare-worker.mjs`. The worker format must be **ES module**.
3. Deploy, and copy the `*.workers.dev` URL.
4. In the reader, open **Settings** and set **Custom CORS proxy** to `https://YOUR-NAME.workers.dev/?url={url}`.
5. Leave the field blank to go back to the public proxies.

From a machine with Wrangler: `npx wrangler login` then `npx wrangler deploy proxy/cloudflare-worker.mjs`.

Cloudflare can still challenge the Worker. If it does, the saved-HTML button is the fallback. Your Worker sees the URLs you request; a public proxy does not.

## Run it locally

```bash
node server.js        # or: npm start
```

Then open **http://localhost:8787**. You need Node 18 or newer. The app has **no runtime dependencies** (no `npm install` needed).

When `/api/health` answers, the page uses the local server instead of a proxy. The server fetches chyoa.com itself (no CORS), keeps chapter text **in memory only**, and serves these same files.

Options (env vars): `PORT=8787`, `HOST=127.0.0.1` (use `0.0.0.0` for LAN, but note that WebCrypto only works on `localhost` or HTTPS), `MIN_GAP_MS=1500` (politeness delay between requests to chyoa.com), `CACHE_TTL_MS=1800000`.

## Features

- **Reader.** Paste a `chyoa.com/story/…` or `chyoa.com/chapter/…` URL. The reader pulls out the title, story, author, chapter number, and question, plus the cleaned chapter HTML (allowlist sanitizer) and the next-chapter choices. You can change the text size, line width, line spacing, and reading font. A scroll progress bar shows how far you are, and you get a word count and reading time. Links inside a chapter that point to other CHYOA chapters open in the reader.
- **Branching.** Choices appear at the end of each chapter. Click one, or press `1`–`9`, to load it in place. A breadcrumb shows the path you took; click any crumb to jump back to it, or press `←`. There is also a **↑ Parent chapter** button that uses CHYOA's own "previous chapter" link.
- **Prefetch.** When this is on, the reader quietly fetches up to 6 next choices, one at a time and at least 1.5 s apart. Choices that are ready show ⚡. If you navigate away, prefetch stops.
- **Follow path.** Optional. When a chapter has only one continuation, the next chapter loads automatically after a 5-second countdown that you can cancel.
- **Story cipher.** The **Cipher** panel uses the same substitution cipher as [ao3-fic-encryptor](https://github.com/MrStarlight69/ao3-fic-encryptor): 95 keyboard characters, `AO3CIPHER$1$` keys, and `AO3SUB` text. Encrypt, Decrypt, Cipher, Saved, and Settings are tabs in that panel. Presets are Caesar shift, Keyword, Reverse (Atbash), Juniper, a random shuffle, and reset. Saved ciphers can be duplicated, deleted, copied, and imported or exported as a key string or `.json`. Copy and Download (`.txt` or `.html`) give the exact text needed to decrypt; the title on the chapter page is not part of that file. Decrypt accepts pasted or uploaded cipher text. Reading mode is full screen for the encrypted chapter and for the decrypted story, and you can bookmark paragraphs. Backup and restore cover the ciphers and bookmarks. Wipe also erases the music playlist and the passphrase library. Themes stay in the Aa panel.
- **What gets scrambled.** The chapter body is encrypted. Titles, the path, and choice URLs stay readable so the next chapter still loads, with the same cipher. Choice labels (and the question) are encrypted only if you turn that on. Juniper folds `A`–`Z` into `a`–`z` on decrypt, because those letters share outputs. Caesar, Reverse, Keyword, and a random shuffle round-trip every character when each output is used once, including accents and emoji. This cipher keeps a story from casual eyes. It is not strong encryption.
- **Encrypted library.** Chapters are saved already ciphered, then wrapped with **AES-256-GCM** (WebCrypto). The key comes from your passphrase via **PBKDF2-SHA-256 with 600,000 iterations** and a random 16-byte salt, and each record gets its own random 96-bit IV. At rest the store holds only `{id, iv, ct}`: titles and URLs are encrypted too. The library starts locked. Use ⏻ or **Lock** to lock it by hand; it can also lock itself after 5, 15, or 60 minutes of inactivity. Your reading session (the path) is saved encrypted as well. **Export** downloads ciphertext-only JSON. **Import** works three ways: it adopts the backup if you have no library yet, merges it if the passphrase is the same, or asks for the backup's passphrase and re-encrypts the chapters under yours. WebCrypto works on GitHub Pages because the site is HTTPS. Your passphrase cannot be recovered.
- **Themes.** There are 13: Frutiger Aero, Frutiger Galaxy, Alba Aero, Musica Aero, Futurism Aero, Frutiger Evil, Dark Aero, Y2K Futurism, Technozen, Helvetica Aqua Aero, Frutiger Aurora, Dreamcore, and Webcore. Each one has its own colours, gradients, glass and gloss effects, font choices, and a background drawn with CSS/SVG; no images or fonts are bundled. Text sits on a solid, high-contrast reading surface in every theme, and the end-to-end test checks for a contrast ratio of at least 7:1. Press `T` / `Shift+T` to cycle themes.
- **Music.** The mini player keeps playing when you change chapters, because the page never reloads. You can add **your own audio files** (they can be remembered on this device in IndexedDB) and **direct stream URLs** (mp3/ogg/aac, internet radio). It has a playlist, shuffle, repeat (all/one/off), volume, and seek, and it supports media keys. No music is bundled.

## Keyboard

`1`–`9` choose · `→` first/only choice · `←` back · `J`/`K` scroll · `+`/`-` size · `[`/`]` width · `T` theme · `L` library · `S` settings · `M` player · `P` play/pause · `/` URL box · `?` help · `Esc` close

## How the site is fetched (politeness)

- All requests go through one serialized queue with at least 1.5 s between them. Duplicate requests that are already in flight are merged, and an LRU memory cache holds up to 300 entries for 30 minutes on the local server (the page keeps a session cache either way).
- The user agent on the local server and on the Worker is `Mozilla/5.0 (compatible; ChyoaPersonalReader/1.0; …)`. Public proxies use their own user agent. robots.txt was `Disallow:` (it allows everything) when this was built.
- Only single chapters are fetched, either the one you asked for or up to 6 prefetched choices. The reader never crawls.

## Error handling

| Situation | What you see |
|---|---|
| Unwritten or deleted branch (CHYOA's "Chapter unavailable" page, HTTP 404) | "Chapter not found", with the reason CHYOA gave |
| Redirect to `/auth/login` (private or members-only content) | "Login required". The reader does not log in for you. |
| Cloudflare challenge (403/503 with `cf-ray` / "Just a moment") | On the local server: "Blocked by CHYOA's CDN". On Pages: that proxy is skipped; if all of them fail, "Could not fetch the chapter" with the HTML button. |
| HTTP 429 | "Slow down", or the next proxy |
| No `chapter-content` block on the page | "Couldn't read this page" (CHYOA probably changed its markup) |
| Non-CHYOA or malformed URL | Rejected before anything is fetched |

**Adult gate.** CHYOA's "I am 18 or older" age check is a client-side overlay. The full chapter HTML is in the page response, so the reader is not blocked by it. Images inside stories are only shown to logged-in members; CHYOA serves a placeholder instead, and the reader labels it.

## Tests

```bash
npm test                                   # parser, proxy, and cipher round-trip tests
npm i -D puppeteer-core && npm run e2e     # end-to-end against the live site; needs Chrome at /usr/bin/google-chrome (or CHROME=…)
```

The end-to-end test does the following: it loads a real chapter (the public CHYOA Guide), checks prefetch, creates the library, follows a choice with the keyboard, and checks that the IndexedDB records and the export contain only ciphertext. Then it locks the library, confirms a wrong passphrase is rejected, unlocks, checks the "not found" handling, switches through all 13 themes with contrast checks, adds a stream URL to the player, and saves screenshots to `screenshots/`. It expects `node server.js` to be running.

## Files

`index.html` and the other root assets (styles, themes, app, vault, player, cipher-ui) · `lib/parse.js` (CHYOA markup parser and sanitizer; also loaded in the browser) · `lib/cipher.js` (substitution cipher, same key and text format as ao3-fic-encryptor) · `lib/fetch-proxy.js` (proxy list and URL checks) · `server.js` (local HTTP, polite fetch queue, cache) · `proxy/cloudflare-worker.mjs`

GitHub Pages is still off for this repository until you turn it on: **Settings → Pages → Build and deployment → Deploy from a branch → main → folder / (root) → Save**. The site is the files at the root of `main`, with `.nojekyll`. After that it is at **https://mrstarlight69.github.io/chyoa-reader/**.

Personal-use tool. Stories belong to their authors on CHYOA; this reader just displays pages you request, the way a browser does.
