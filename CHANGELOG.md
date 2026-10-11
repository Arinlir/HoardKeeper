# Changelog

Everything since the v1.3 release (2026-08-17). Release notes for v2.0 are on the GitHub releases page.
Newest first. The repository keeps its old name, HoardKeeper; the app is now **Binderwyrm**.

## 2026-10-12 — Free-text commanders, Stats

### Added
- **Commander per seat, typed in** (replaces "pick a deck for the seat"). Any commander, not tied to
  your collection, so it works for friends who play cards you don't own. It is checked against real
  cards as you type: matching commanders are offered as buttons, a "Real card" tick appears on a
  match, and anything that isn't a card is kept as typed. Cards that "can be your commander" count.
- **Seat name follows the commander**: a seat whose name isn't filled in takes the commander's name;
  a name somebody typed is kept and the commander is shown beside it.
- **Stats** in the Life counter menu: wins per player (only seats with a name filled in), wins per
  commander and the latest games, for **this device** or the **whole server** (every signed-in
  account shares one list of finished games). `GET/POST /api/life/games`, stored in `accounts.db`.

### Changed
- Finished games no longer land on a collection deck's record; the commander is recorded by name.

## 2026-10 — Precon import, Life counter partners, accounts hardening

### Added
- **Precon deck import** (Import → Precon deck): search every printed precon and add all of its
  cards as the exact printings it shipped with (set, collector number, art, foil/etched), commander
  and extras included, optionally into a new collection named after the deck.
- **Life counter: two commanders per seat.** A partner deck shows commanders A and B; commander
  damage is counted per commander, and in your own seat you choose which one is dealing it.
  Switching a seat to partners sets this up.
- **Commanders and partners** in the deck builder: Partner, Partner with, Friends forever,
  Choose a Background, Doctor's companion; combined colour identity.
- **Sub-collections** (nested collections with rolled-up totals).
- **Price source setting** (Scryfall USD vs Cardmarket, with fallback).
- **Trade note** on each card, shown on trade lists and playgroup matches.
- **Full-screen Add a card** search.
- **Sets roster sort** options.
- **Deck tags, deck stats, set image as deck cover, bracket estimate.**
- **Deck import keeps type categories**; deck roles show their cards on hover; remove a card
  directly from the gallery.
- **Collection paste import** (`1 Sol Ring (LTC) 59` lists).
- **Account: signed-in devices, backup download / restore, contact line, link previews** for public pages.
- **Two-factor sign-in** (TOTP) with recovery codes.
- **Admin space** at `/admin`: server settings, accounts, restart, unclaimed legacy profiles.
- **Local card database**: the server keeps Scryfall's bulk data so scans, searches and imports
  answer in milliseconds; `CARD_DB=off` disables it.
- **Phone apps** (Capacitor, Android and iOS) with a **live camera scanner**: continuous mode,
  name + set-code check, full-card fallback when the code can't be read. See `MOBILE.md`.
- **Accounts edition**: email + password accounts replace PIN profiles; old PIN profiles can be
  claimed once.
- **URL routing**: views and open cards have addresses, back/forward work.

### Changed
- **Life counter restyled** (flat slate panels, notched corners, muted seat colours, night-sky
  background) so it stands apart from other life-counter apps; behaviour unchanged.
- Renamed **HoardKeeper → Binderwyrm** (2026-09-07). Storage keys and `data/` are unchanged.
- Fonts are self-hosted; no request to Google Fonts.
- README rewritten for the above.

### Fixed
- A vault that failed to load was treated as empty and could be saved over; load failure now
  blocks saving and shows the error.
- Cost split ignored quantity; it is now by quantity.
- Prices did not repaint on currency / rate change (`React.memo` `moneyKey`).
- Closing a modal by its backdrop no longer breaks URL routing.
- Token panel: dungeon cards were mishandled.
- Scanner: reading failures fall back to the whole card face instead of giving up.
- Precon import leaves no empty collection behind when the lookup fails.

### Security (October review)
- Stored XSS on public pages (wishlist / guest view) closed; public pages restricted to
  Scryfall links and images (`safe-url.cjs`).
- Rate limiting no longer trusts spoofable `X-Forwarded-For`.
- Account lockout and login throttling; stricter response headers.
- Public payloads built from explicit allow-lists only.

## Earlier in 2026-09
- Currency rates update themselves (ECB via Frankfurter, fallback open.er-api.com).
- Export formats for Binderwyrm, Archidekt, Moxfield, ManaBox and plain decklists.
- Goldfish hand tester, mana-base analysis, table record on decks, trade binder and playgroup,
  wishlist / proxy flags, read-only guest view.
