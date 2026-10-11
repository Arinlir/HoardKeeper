# Binderwyrm on Android and iPhone

The phone app is the same React app as the website, packaged as a native app
with [Capacitor](https://capacitorjs.com) 8. Every feature comes along: the
collection, sets, decks, wishlist, glossary, playgroup and life counter. There
is one addition: a **live card scanner** that reads cards straight from the
camera with the phone's own text recognition.

```
src/                     the app — shared by web, Android and iOS
native/live-scanner/     the scanner plugin (Java + ML Kit, Swift + Vision)
android/                 Android Studio project (generated, then committed)
ios/                     Xcode project (generated, then committed)
capacitor.config.json    app id, name, colours
```

## How the phone app reaches your data

It never touches `data/profiles/*.json` directly. It talks to your Binderwyrm
server over the same HTTP API the website uses (`/api/store` with its sign-in
token, `/api/cards/*`, …).

- **First launch** shows a *Where does your vault live?* screen. Enter your
  server's address (e.g. `hoard.arinvault.eu`), or pick **Keep it on this
  phone only**. The address is checked (`/api/health`) before it's kept. Then
  the email and password sign-in appears (with "Move it to an account" while old
  PIN profiles are waiting to be claimed). The app gets a sign-in token instead of a
  cookie, because iOS blocks cookies for other sites inside apps.
- The address must be **https**. Phones refuse plain-http calls from inside
  an app. Zoraxy already provides TLS.
- **Settings → Server** shows the current server and lets you change it.
- If the server can't be reached at launch, the Connect screen comes back
  with the reason. The app doesn't open an empty collection and start saving
  into it.

### Server changes this needed (already in `server.cjs`)

- **CORS.** The app's pages come from `https://localhost` (Android) or
  `capacitor://localhost` (iOS), so `/api/*` answers those two origins. Add
  more with `CORS_ORIGINS=https://a,https://b` (e.g. `http://localhost:5173`
  to run `vite dev` against a real server). Static pages never get CORS
  headers.
- **Save conflicts.** A save sends the whole vault. Before this change, a
  phone and a desktop open at the same time could silently overwrite each
  other. Each vault now has a revision number:
  - A device says which revision it loaded (`X-Base-Rev`), and the save is
    refused with `409` if someone else has saved since.
  - The app then shows *"changed on another device — Load latest"* and stops
    saving until you do.
  - Coming back to the app (unlocking the phone, switching tabs) quietly pulls
    in a newer copy when nothing local is waiting to be saved.
  - Saves without the header (a browser tab left open from before the update)
    still work as they always did.

**Redeploy the server** (`docker compose up -d --build`) before using the
phone app against it.

## The live scanner

In the phone app, *Add card → Scan* opens a full-screen camera with a
card-shaped guide:

- Text is read on the phone: **Google ML Kit** on Android (bundled model,
  works offline, no Play Services needed) and **Apple Vision** on iPhone.
  Nothing is uploaded.
- The recognised text goes through the same collector-line parser as the web
  scanner (`src/lib/ocr.js`). Bottom-of-card lines are tried first, then the
  whole card, then the whole frame.
- A code is accepted once **two frames agree**, so a single misread digit
  never gets through. The card is then looked up exactly as if it had been
  typed.
- After you add it, the camera reopens for the next card, so you can work
  through a stack.
- You can tap to focus, and there's a torch button. The Android back button
  closes the scanner.

How it's drawn:

- The camera is a native view *behind* the WebView, and the page turns
  see-through while scanning (`html.bw-scanning` in `src/index.css`). That's
  why the scanner overlay is portalled outside `#root`.
- The UI is the app's own React (`LiveScanOverlay.jsx`). The logic that
  decides what a frame means is plain JS in `src/lib/liveScan.js`, and
  `live-scan-test.jsx` covers it.
- In a browser nothing changes: the website keeps the Tesseract photo scanner.

## Building it

After pulling these changes, run `npm install` once on each machine (new
packages: `@capacitor/*` and the local scanner plugin).

### Android (Windows is fine)

1. Install **Android Studio** (it brings the SDK and a JDK 21).
2. `npm run android`. This builds the web app, copies it into `android/`
   (`cap sync`) and opens Android Studio.
3. In Android Studio, pick a device (USB debugging on, or an emulator) and
   press **Run**.

### iPhone (needs a Mac: the Mac mini works)

1. Install **Xcode** from the App Store, and Node 22+.
2. Clone or copy the repo onto the Mac, then `npm install`, then
   `npm run ios`.
3. In Xcode: select the *App* target → *Signing & Capabilities* → pick your
   team. Plug in the iPhone (enable Developer Mode on it) and press **Run**.

iOS uses Swift Package Manager (Capacitor 8's default), so CocoaPods isn't
needed.

### After changing web code

`npm run cap:sync` (or `npm run android` / `npm run ios`) copies the new
build into both native projects. Native projects don't pick up `src/`
changes by themselves.

## Before the stores

| | Google Play | App Store |
|---|---|---|
| Account | $25 once | $99 / year (Apple Developer Program) |
| New personal accounts | 12+ testers on a closed test for 14 days before production | — |
| Needs | privacy policy URL, data-safety form, 512px icon, screenshots | privacy policy URL, privacy "nutrition label", screenshots, **a demo server + profile for App Review** |

Done:

- **Fonts are bundled** (`src/fonts.js`, `@fontsource/*`). No requests to Google, and text renders
  correctly offline.
- **Wrong-guess throttling** (`pin-guard.cjs`). After 5 wrong passwords (or PINs when claiming an old profile), a client is locked out of that
  account for 30 s, doubling up to 15 min. A spread-out attack on one profile locks out every address
  that has guessed wrong, while the owner on a clean address still gets in. The server answers
  `429` with `Retry-After`. Behind Zoraxy, the client address comes from the rightmost
  `X-Forwarded-For` entry.
- **A failed load no longer looks like an empty vault.** The app shows the error with a retry and
  saves nothing until a load succeeds. Before, a network blip could let the first autosave write an
  empty collection over the real one.
- **Privacy policy**: `public/privacy.html`, served at `https://hoard.arinvault.eu/privacy.html`
  (use that URL in both store listings). It's linked from Settings and from the phone app's Connect
  screen.
- **Trademark search** (TMview, 28 Sep 2026: EUIPO, ÚPV CZ, USPTO, WIPO, UK and 70+ offices): no
  registration or application for BINDERWYRM or close spellings. See `claude/trademark_check.md` in
  the project for the neighbours worth knowing about.

Still to do for a store release:

- **App id.** `eu.arinvault.binderwyrm` in `capacitor.config.json` becomes
  permanent once the app is published. Change it before the first upload if
  you want a different one (then re-run `npx cap sync`; on Android also rename
  the `MainActivity` package folder).
- **Icons and splash.** Still Capacitor's defaults. Put a 1024×1024 icon in
  `assets/icon.png` and run `npx @capacitor/assets generate`.
- **Decide which server the store listing points people at.** Servers are accounts-only now
  (like `hoard.arinvault.eu`). For strangers from the store, run one with email set up
  (see the README) and give App Review a test account on it.
- **Privacy policy facts to confirm**: the contact address, how long Zoraxy's
  access logs and backups are kept (the policy says 30 days), and the minimum
  age (13).
