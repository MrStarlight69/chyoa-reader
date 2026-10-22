# Aero Reader for CHYOA

A personal, distraction-free reader for [CHYOA](https://chyoa.com) interactive stories. It has an encrypted local library, 13 themes, and a music player.

## Run it (one command)

```bash
node server.js        # or: npm start
```

Then open **http://localhost:8787**. You need Node 18 or newer. The app has **no runtime dependencies** (no `npm install` needed).

Options (env vars): `PORT=8787`, `HOST=127.0.0.1` (use `0.0.0.0` for LAN, but note that WebCrypto only works on `localhost` or HTTPS), `MIN_GAP_MS=1500` (politeness delay between requests to chyoa.com), `CACHE_TTL_MS=1800000`.

## Features

- **Reader.** Paste a `chyoa.com/story/…` or `chyoa.com/chapter/…` URL. The backend fetches the page server-side (so there are no CORS problems), then pulls out the title, story, author, chapter number, and question, plus the cleaned chapter HTML (allowlist sanitizer) and the next-chapter choices. You can change the text size, line width, line spacing, and reading font. A scroll progress bar shows how far you are, and you get a word count and reading time. Links inside a chapter that point to other CHYOA chapters open in the reader.
- **Branching.** Choices appear at the end of each chapter. Click one, or press `1`–`9`, to load it in place. A breadcrumb shows the path you took; click any crumb to jump back to it, or press `←`. There is also a **↑ Parent chapter** button that uses CHYOA's own "previous chapter" link.
- **Prefetch.** When this is on, the reader quietly fetches up to 6 next choices, one at a time and at least 1.5 s apart. Choices that are ready show ⚡. If you navigate away, prefetch stops.
- **Follow path.** Optional. When a chapter has only one continuation, the next chapter loads automatically after a 5-second countdown that you can cancel.
- **Encrypted library.** Chapters are saved in IndexedDB using **AES-256-GCM** (WebCrypto). The key comes from your passphrase via **PBKDF2-SHA-256 with 600,000 iterations** and a random 16-byte salt, and each record gets its own random 96-bit IV. At rest the store holds only `{id, iv, ct}`: titles and URLs are encrypted too. The library starts locked. Use ⏻ or **Lock** to lock it by hand; it can also lock itself after 5, 15, or 60 minutes of inactivity. Your reading session (the path) is saved encrypted as well. **Export** downloads ciphertext-only JSON. **Import** works three ways: it adopts the backup if you have no library yet, merges it if the passphrase is the same, or asks for the backup's passphrase and re-encrypts the chapters under yours. The server keeps chapter text **in memory only** (cache with a 30-minute TTL) and never writes plaintext to disk. Your passphrase cannot be recovered.
- **Themes.** There are 13: Frutiger Aero, Frutiger Galaxy, Alba Aero, Musica Aero, Futurism Aero, Frutiger Evil, Dark Aero, Y2K Futurism, Technozen, Helvetica Aqua Aero, Frutiger Aurora, Dreamcore, and Webcore. Each one has its own colours, gradients, glass and gloss effects, font choices, and a background drawn with CSS/SVG; no images or fonts are bundled. Text sits on a solid, high-contrast reading surface in every theme, and the end-to-end test checks for a contrast ratio of at least 7:1. Press `T` / `Shift+T` to cycle themes.
- **Music.** The mini player keeps playing when you change chapters, because the page never reloads. You can add **your own audio files** (they can be remembered on this device in IndexedDB) and **direct stream URLs** (mp3/ogg/aac, internet radio). It has a playlist, shuffle, repeat (all/one/off), volume, and seek, and it supports media keys. No music is bundled.

## Keyboard

`1`–`9` choose · `→` first/only choice · `←` back · `J`/`K` scroll · `+`/`-` size · `[`/`]` width · `T` theme · `L` library · `S` settings · `M` player · `P` play/pause · `/` URL box · `?` help · `Esc` close

## How the site is fetched (politeness)

- All requests to chyoa.com go through one serialized queue with at least 1.5 s between them. Duplicate requests that are already in flight are merged, and an LRU memory cache holds up to 300 entries for 30 minutes.
- The user agent is honest: `Mozilla/5.0 (compatible; ChyoaPersonalReader/1.0; …)`. robots.txt was `Disallow:` (it allows everything) when this was built.
- Only single chapters are fetched, either the one you asked for or up to 6 prefetched choices. The reader never crawls.

## Error handling

| Situation | What you see |
|---|---|
| Unwritten or deleted branch (CHYOA's "Chapter unavailable" page, HTTP 404) | "Chapter not found", with the reason CHYOA gave |
| Redirect to `/auth/login` (private or members-only content) | "Login required". The reader does not log in for you. |
| Cloudflare challenge (403/503 with `cf-ray` / "Just a moment") | "Blocked by CHYOA's CDN" with the HTTP status |
| HTTP 429 | "Slow down" |
| No `chapter-content` block on the page | "Couldn't read this page" (CHYOA probably changed its markup) |
| Non-CHYOA or malformed URL | Rejected before anything is fetched |

**Adult gate.** CHYOA's "I am 18 or older" age check is a client-side overlay. The full chapter HTML is in the server response, so the reader is not blocked by it. Images inside stories are only shown to logged-in members; CHYOA serves a placeholder instead, and the reader labels it.

## Tests

```bash
npm test                                   # offline parser test (synthetic fixture)
npm i -D puppeteer-core && npm run e2e     # end-to-end against the live site; needs Chrome at /usr/bin/google-chrome (or CHROME=…)
```

The end-to-end test does the following: it loads a real chapter (the public CHYOA Guide), checks prefetch, creates the library, follows a choice with the keyboard, and checks that the IndexedDB records and the export contain only ciphertext. Then it locks the library, confirms a wrong passphrase is rejected, unlocks, checks the "not found" handling, switches through all 13 themes with contrast checks, adds a stream URL to the player, and saves screenshots to `screenshots/`.

## Files

`server.js` (HTTP, static files, polite fetch queue, cache) · `lib/parse.js` (CHYOA markup parser and sanitizer) · `public/` (index.html, styles.css, themes.css, app.js, vault.js (crypto), db.js (IndexedDB), player.js)

Personal-use tool. Stories belong to their authors on CHYOA; this reader just displays pages you request, the way a browser does.
