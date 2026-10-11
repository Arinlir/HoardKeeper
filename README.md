# Binderwyrm

*Formerly HoardKeeper — same app, less crowded name. Nothing about your stored collection changed: the vault, its storage keys and the `data/` folder are untouched.*

A self-hosted Magic: The Gathering collection tracker with a soul. Add cards, watch their
market value move, record what you actually paid for boosters and precons, track set
completion, draft Commander and 60-card decks from what you own, and share the vault with
your playgroup through named profiles.

Runs in your browser against Scryfall's public API. Standalone it needs no server — the
collection lives in localStorage; the bundled Node server adds per-person accounts (email +
password, optional two-factor), server-side storage, an admin page, a local copy of Scryfall's
card data, and the API the Android / iPhone apps talk to. No telemetry either way.

What changed and when: [CHANGELOG.md](CHANGELOG.md).

---

## Running it on Windows

You need [Node.js](https://nodejs.org) — grab the **LTS** installer and accept the defaults.

Then just double-click **`start.bat`**. The first run installs dependencies (about a minute), after that it starts immediately and opens <http://localhost:5173> in your browser.

Prefer the terminal? From PowerShell in this folder:

```powershell
npm install    # first time only
npm run dev
```

To stop the server, close the window or press `Ctrl+C`.

### Hosting it on Arinserver (Docker + Zoraxy)

The repo ships a small Node server (`server.cjs`) that serves the built app **and** stores each
person's collection in a named profile on the server, so vaults follow people rather than
browsers. On the Mac mini:

```bash
docker compose up -d --build
```

That builds the image and runs it on **port 8420**, with profile data in `./data` — back that
folder up like anything else.

To reach it from outside the machine, put a reverse proxy in front (Caddy, nginx, Traefik,
Zoraxy — any of them):

- Host: whatever hostname you'll use, e.g. `hoard.example.com`
- Target: `http://<server-lan-ip>:8420`
- TLS: terminate it at the proxy

Running it without Docker works too: `npm run build && npm start`, with `PORT` and
`DATA_DIR` env vars to taste. The server has no npm dependencies of its own; it needs a Node
with `node:sqlite` (the Docker image provides one) for the accounts database. The image is built locally, so tools like Watchtower won't
auto-update it — rebuild with `docker compose up -d --build` after changes.

### Accounts (email + password)

Sign-in is an email and a password (10+ characters, stored as a scrypt hash). Each account has
one private vault. PIN profiles no longer exist — see "Moving old PIN profiles" below.

- Accounts live in `DATA_DIR/accounts.db`, using Node's built-in SQLite, so there are still no
  npm dependencies on the server.
- The website signs in with an HttpOnly cookie. The phone app signs in with a token.
- Wrong passwords are throttled (`pin-guard.cjs`, keyed per account and per address).
- Saves use a "changed on another device" revision check.
- Without the server (plain `npm run dev` or static hosting), the app falls back to browser
  localStorage exactly as before.

**Public handle.** An account shares nothing until it picks a handle (Settings → Account). The
handle is the name in `/w/<handle>` (your wishlist, open to anyone with the link — built from an
explicit allow-list in `public-wishlist.cjs`, so the collection, what you paid, decks and history
never appear), `/v/<handle>` (the read-only collection, only if you switch it on), and in the
playgroup list that other signed-in users see. Clear the handle and all of it stops answering.

```yaml
services:
  binderwyrm:
    build: .
    container_name: binderwyrm
    restart: unless-stopped
    ports:
      - "8420:8420"
    volumes:
      - ./data:/data
    environment:
      - TZ=Europe/Prague
      - PUBLIC_URL=https://hoard.example.com   # used for links in emails
      - REGISTRATION=open                      # "closed" stops new sign-ups
      # Email (confirm address, reset password). Leave SMTP_HOST out to run without email.
      - SMTP_HOST=smtp.example.com
      - SMTP_PORT=587                          # 465 = TLS from the start, 587 = STARTTLS
      - SMTP_USER=no-reply@example.com
      - SMTP_PASS=change-me
      - SMTP_FROM=Binderwyrm <no-reply@example.com>
```

**Without email** (no `SMTP_HOST`):

- New accounts are confirmed straight away and signed in.
- "Forgot password" can't send anything. Reset a password from the server instead:

```bash
docker exec binderwyrm node auth-accounts.cjs reset-password someone@example.com
docker exec binderwyrm node auth-accounts.cjs list
```

**With email:**

- `PUBLIC_URL` is required. Links in emails are built from it and never from the request's
  `Host` header.
- The server refuses to start without it.

**Moving old PIN profiles.** Profile files in `DATA_DIR/profiles/` are no longer used to sign in.
They stay on disk, read-only, so their owners can move them: on the sign-in screen, "Move it to an
account" asks for the old profile name and PIN once, plus an email and a new password. The
profile's vault becomes the account's (same collection, decks, wishlist, history), its name
becomes the account's handle so existing `/w/` and `/v/` links keep working, and the old file is
left untouched as a backup. Until a profile is claimed its shared links keep answering and its
name is reserved. Claiming works even with `REGISTRATION=closed`. The option disappears from the
sign-in screen when no unclaimed profiles are left. Back up `DATA_DIR` before the first deploy.
A profile saved without a PIN could always be opened by anyone who knew its name, so the first
person to claim it gets it.

### Account extras

- **Signed-in devices** (Settings → Account): every browser and phone app signed in to the account, when it
  was last active, a sign-out button for each, and "Sign out all other devices". Sessions carry a short
  label taken from the browser's user-agent ("Firefox on Windows", "Phone app (Android)") — nothing else
  about the device is stored.
- **Backup / restore** (Settings → Account): *Download backup* saves the whole vault (cards, decks,
  wishlist, collections, history, settings) as `binderwyrm-backup-<date>.json`; *Restore from a backup…*
  replaces the vault with a chosen file after a confirmation, then reloads. A bare vault JSON is accepted too.
- **Contact line:** admin page → Settings → *Contact line* (or `CONTACT_INFO`). Shown on the sign-in and
  locked-account screens (an email or web address becomes a link).
- **Link previews:** `/w/<handle>` and `/v/<handle>` carry title, description and a card image in their
  `<meta>` tags so chat apps can unfurl them. Built from the same allow-listed data as the public pages;
  a handle that hasn't shared looks the same as one that doesn't exist. Marked `noindex`. Cached 5 minutes.

### Two-factor sign-in

Optional for everyone, and available for the admin space too. It's a standard authenticator-app code (TOTP, RFC 6238 — Aegis, Google Authenticator, 1Password, …), with no extra service and no SMS.

- **Turn it on:** Settings → Account → *Two-factor sign-in* (admin: *Server* tab → *Admin two-factor*). Confirm with your password, scan the QR (or type the key), enter the first code, and save the **8 recovery codes** — each works once and they're shown only then.
- **Signing in** then asks for the code after the password (phone app too). A recovery code works in the same box.
- **Wrong codes count like wrong passwords:** 5 wrong in an hour locks the account until the admin unlocks it. A code can't be used twice, and the sign-in step expires after 5 minutes / 5 tries.
- **A password reset does not switch it off** (otherwise a stolen email would bypass it). Lost phone *and* recovery codes: the admin uses *Accounts → Turn off two-factor*, or on the server `node auth-accounts.cjs reset-mfa someone@example.com`. Locked out of the admin space itself: `node admin.cjs reset-mfa` (needs access to the server's files, which is the point).
- **Storage:** secrets are encrypted (AES-256-GCM) with `DATA_DIR/totp.key`; recovery codes are stored only as hashes. **Back `totp.key` up with the rest of `DATA_DIR`** — without it, enrolled users would need their two-factor reset.

Sharing defaults: for a *new* account, "Let anyone with the link browse this collection" and "Share my trade list" start **on**. Nothing is reachable until the person picks a public handle, and existing accounts keep what they chose.

### Security notes

- **Wrong passwords lock the account.** Five wrong passwords within an hour lock an account until the
  admin unlocks it (admin page → Accounts → *Unlock*, or `docker exec binderwyrm node auth-accounts.cjs
  unlock <email>`) or sends a reset link (*Send reset link*; emailed if SMTP is set up, otherwise shown to
  you to pass on). Locked accounts can't use "Forgot password" themselves, and the right password is
  refused while locked. The lock lives in the database, so restarts don't clear it. Trade-off: anyone who
  knows an email address can lock that account. The admin login and old-profile claims allow 5 wrong
  guesses per hour in total, then refuse everyone for the rest of the hour.
- **Sign-up block:** the bar at the top of every admin page blocks or reopens new sign-ups in one click.
- **Bind the port to the proxy only.** Zoraxy/Caddy on the same machine: publish the container as
  `127.0.0.1:8420:8420` in `docker-compose.yml`. Behind a proxy the server trusts the last
  `X-Forwarded-For` entry for rate limiting; if port 8420 is also reachable directly that header can be
  invented.
- **Old PIN profiles without a PIN can be claimed by anyone who types their name.** The admin page's
  Server tab lists unclaimed profiles and flags those. Claim them first, then set *Moving old PIN
  profiles* to Closed (or `CLAIM_PROFILES=closed`).
- Public pages (`/w/…`, `/v/…`) only ever carry `https://scryfall.com` links and
  `https://*.scryfall.io` images (`safe-url.cjs`) — a vault can't turn them into a script or a tracking pixel.
- Responses carry `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`; unauthenticated public
  and card-search endpoints are rate limited; sign-ups have a server-wide hourly cap; unconfirmed empty
  sign-ups are deleted after a week.

### The admin space (`/admin`)

A password-locked page for whoever runs the server. It replaces most trips to `docker-compose.yml`:

- **Settings** — new sign-ups open/closed, public address, secure cookies, the whole SMTP block
  (with a *Send test email* button that tries what is in the boxes before you save), extra app
  origins, the local card database. Changes that can apply live do so on save; the page marks the
  few that need a restart (the card database settings).
- **Accounts** — list accounts, confirm an email, sign someone out everywhere, give someone a
  temporary password (replaces the `docker exec … reset-password` command, which still works).
- **Server** — uptime and status, *Restart the server*, *Sign every user out*, change the admin
  password.

**First time:** open `/admin`. With no admin password set, the server prints a one-time setup code
in its log (`docker compose logs binderwyrm | grep "setup code"`); enter it and choose a password
(12+ characters). Or set `ADMIN_PASSWORD` in the environment and skip that — then it can only be
changed there. `ADMIN=off` switches the admin space off entirely.

**Where settings are kept:** `DATA_DIR/config.json` (readable only by the server's user — the SMTP
password is in it, as it would be in the compose file; it is never shown again in the page or the
log). A saved value beats the environment variable of the same name; *reset* next to a field hands
it back to the environment. `PORT` and `DATA_DIR` stay environment-only. `admin.json` beside it
holds the admin password's hash.

**Restart** exits the server and relies on Docker's `restart: unless-stopped` (already in the
supplied compose file) to start it again. Without a supervisor it just stops.

**Safety:** the admin API only answers requests from its own page (same origin, a custom header,
`SameSite=Strict` cookie), so other websites and the phone app can't use it; wrong passwords are
throttled; sessions end after 12 hours or 2 idle. Put it behind HTTPS like the rest (Zoraxy), and
if you want it unreachable from outside, block `/admin` and `/api/admin` for external addresses
in the proxy.



```powershell
npm run build
```

The output lands in `dist/` as plain HTML/CSS/JS. Copy that folder anywhere that serves static files — IIS, nginx, Caddy, or behind Zoraxy. `vite.config.js` sets `base: "./"`, so it works from a subpath without further configuration.

### The phone app (Android / iPhone)

The same app, packaged for phones with Capacitor, plus a live camera scanner that reads cards with the phone's own text recognition. It connects to your server over the same API the website uses (you enter the address on first launch), or runs on the phone alone. Building it, the server changes it relies on, and what's left before the app stores: see [MOBILE.md](MOBILE.md).

---

## Where your data lives

**Run through `server.cjs` (Docker or `npm start`):** each signed-in account's vault is stored
on the server under `DATA_DIR` (default `./data`), with accounts in a small SQLite file next to
it. Back that folder up. Account settings has **Download backup** and **Restore from backup**
for a vault-only copy you can keep elsewhere, and an installed server keeps rolling copies of
what it saves. A vault that fails to load is never treated as an empty one: the app shows the
error and refuses to save over it.

**Opened standalone (`npm run dev`, no server):** everything is in your browser's
`localStorage` under `ledger-foil-data`. It is tied to that browser on that machine, clearing
site data wipes it, and private windows keep nothing. Use **Export → Binderwyrm** as your
backup; it can be re-imported in full.

The storage layer is a single `store` object (`src/lib/store.js`) with `get` and `set`, so
pointing it somewhere else is a one-file change.

---

## Features

**Adding cards.** *Add a card* is a full-screen search: type a name (or a Scryfall-style query), see every printing with its art, pick one, set quantity, finish and collection. Manual entry is there for anything Scryfall doesn't know about. On the phone apps the live scanner reads a card's name and set code from the camera, can run continuously down a stack, and falls back to matching the whole card face when the code is unreadable.

**Precon decks.** *Import → Precon deck* lists every printed precon (searchable, newest first). Pick one — say Food and Fellowship — and it adds every card in the product as the exact printing it shipped with (set code, collector number, art, foil/etched finish), commander and extras included, optionally into a new collection named after the deck so you can enter what you paid. Deck lists come from MTGJSON; cards are resolved by Scryfall id.

**Pasting a list.** *Import → Paste* accepts plain `1 Sol Ring (LTC) 59` style lists into a collection, with the same matching rules as CSV import.

**Collections and cost basis.** Create a collection for a purchase — a Commander precon, a bundle, a booster box — and give it the total you paid. That cost is split evenly across the cards you assign to it, so every card carries a share of what the product cost. Override any individual card when the even split isn't right (the chase rare in a bundle, say), and the remainder redistributes across the rest automatically. The split is by quantity, so a playset takes four shares, not one. Collections can be nested: a *Binder 1* inside *Trade stock*, with totals rolling up.

The **Collections** button in the header opens the manager: rename a collection, edit what you invested in it, see its current value and gain side by side, reset a total back to zero, or delete it (its cards fall back to Uncategorized). *Reset all invested* clears every total at once if you want to re-enter your cost basis from scratch.

**CSV import.** Works with ManaBox, Moxfield, Deckbox and TCGplayer exports. It reads your header row, guesses which column is which, and shows you the mapping so you can correct it before importing. Each distinct value in your collection/binder column becomes a real collection, and if the file has purchase prices they're summed into that collection's total. Matching goes through Scryfall's batch endpoint — 75 cards per request, using Scryfall ID where your file has one, otherwise set + collector number, otherwise name. Anything the batch misses gets a fuzzy retry. A trade note and a price source (below) travel with the card.

Turn the lookup off and the import is instant and offline, using only what's in the file. Map a "Current value" column and your collection is fully valued without touching the network.

`sample-collection.csv` in this folder shows the expected shape.

**Searching.** The box searches names and the rules text printed on the card, and it also
takes a query language modelled on Scryfall's, so you can say what you actually mean:
`t:goblin` (type line), `o:"draw a card"` (rules text), `c:rg` (red and green), `r:mythic`,
`set:ltr`, `cmc<=3`, `price>20` (in whatever currency you're displaying), `qty>=4`,
`is:foil` / `is:proxy` / `is:wanted` / `is:dfc` / `is:commander`, `tag:trade`, `col:vault`,
`deck:atraxa`, `f:commander` / `banned:modern` / `restricted:vintage`, `!"sol ring"` for an
exact name. Any term can be negated with a leading `-`, terms combine, and `or` takes either
side. Plain words behave exactly as they always did, so nothing you already type breaks. The
**?** button beside the box lists every term with an example you can click to add.

**Tags.** Your own labels on your own cards - "trade", "sleeved", "sentimental" - added on a
card or across a whole selection at once, offered back as one-tap suggestions so a collection
doesn't sprout six spellings of the same word, searchable with `tag:`, and written to (and read
back from) CSV.

**Formats and banlists.** Every price refresh now also stores what Scryfall says about a
printing's legality, packed to a letter per format so a large collection doesn't carry a
megabyte of the word "not_legal" around. A deck declares its format - Commander, Standard,
Pioneer, Modern, Legacy, Vintage, Pauper, Brawl, Duel Commander - and the deck page names
anything banned, restricted, or over that format's copy limit, with basics and "any number of
cards named..." cards exempted as the rules exempt them. A card whose legality has never been
fetched is reported as unchecked, not quietly counted as legal. Card detail shows the same
thing per card, as badges.

**Deck categories.** The six roles the drafter fills - lands, ramp, draw, removal, wipes,
creatures - are defaults rather than a cage. Name a group of your own ("combo pieces", "stax",
"the Dockside package"), move any card into it with the tag button on its row, rename it, or
delete it; deleting a group returns its cards to Other spells rather than losing them.

**Price source.** Settings picks where a card's number comes from — Scryfall's USD, or Cardmarket EUR/trend, with a fallback when the preferred source has no price for that printing — and every total, chart and guest page follows it.

**Trade notes.** Each card has an optional note shown on your trade list and to playgroup matches ("NM, prefer swap for a Command Tower").

**Buying.** Card detail, the wishlist and a deck's cards-to-buy list all carry the same three
links - Cardmarket, TCGplayer, Scryfall - built from the card's name, so they work for cards
added years ago as well as ones added today. And if you display totals in euros, prices come
from Cardmarket rather than from dollars run through today's rate: the number on the card is
the number you'd actually pay. Settings has a switch if you'd rather value everything in
dollars.

**Price tracking.** *Refresh prices* re-checks the whole collection in batches. Each refresh stores a dated snapshot, which feeds the value-over-time chart, and records the previous price per card, which feeds the Movers list — what gained and what dropped since you last looked. Snapshots are one per day, last 180 kept.

**Sets.** The second tab tracks completion, MTG Collection Builder-style. Every set you own cards from is listed with a completion percentage; expanding one loads the full roster from Scryfall (cached locally for a week) and shows per-rarity progress bars plus every card in the set with a +/− quantity stepper — tap through a booster box without opening a single dialog. New cards created from the roster land in whichever collection you pick in the roster header. Filter the roster to All / Missing / Owned, search within it, and jump to Cardmarket from any row.

**Decks.** The third tab is a Commander deck builder that works from what you own. Pick any legendary creature in your collection as commander — or a legal pair: Partner, Partner with, Friends forever, Choose a Background and Doctor's companion are all recognised, with combined colour identity, and decks can be tagged and given a set image as cover. Deck stats show curve, colours, a bracket estimate and category totals; importing a list keeps the type categories it came with; roles can be hovered for the cards in them, and a card is removed straight from the gallery. With a commander chosen, hit *Auto-build*: the drafter fetches your cards' rules text from Scryfall (cached locally), classifies every card in the commander's color identity by role — lands, ramp, draw, removal, board wipes — fills sensible quotas (37 lands, 10 ramp, 10 draw, 8 removal, 3 wipes), scores the rest by synergy with the commander's text and creature types, and tops up the mana base with basic lands split by your color pips. Singleton and color identity are enforced. The result lands in role columns you can prune by hand, with a search box to add anything in-identity from your collection, a running deck value, and one-click decklist export for Moxfield or Archidekt. Re-draft any time — it's a starting 100, not gospel: the drafter reads rules text, not the meta, so treat it as a fast first pass to tune at the table.

**Cards you don't own.** A deck isn't limited to your binder. Switch the add box to *Any
card* and it searches all of Magic; anything you add joins the deck marked **to buy** —
greyed in the card view, tagged in the roles list, priced like everything else. The deck
header says how many are missing and what they'd cost, and the panel under it puts them on
your wishlist (individually or all at once) or, when you've bought one, moves it into your
collection with *I own it*. Importing a decklist now offers to bring the cards you don't own
in the same way, so pasting someone's list gives you the whole deck and a shopping list
rather than a list of things that were skipped. If a missing card turns up in your collection
any other way — a CSV import, the wishlist, typed in by hand — the deck quietly swaps the
placeholder for the real card. Placeholders belong to their deck, so two decks can plan for
the same card without fighting over a copy the way physical cards do.

A 60-card constructed mode sits alongside it: pick one or two colors instead of a commander, and the drafter builds toward 24 lands with up to four copies of a card — never more than you own — inferring a theme from your most common creature type. Deck rows get ×-count steppers, and export writes proper `4 Lightning Bolt` lines.

**Testing a deck.** *Test hand* on any deck opens two things a decklist can't tell you by
looking at it. **Opening hand** shuffles the deck's actual cards — every copy its own card, basics
included, commander left in the command zone — deals seven, does London mulligans properly (draw
seven, put one on the bottom per mulligan, you choose which), and then draws a card a turn, with
lands/spells/curve read out underneath. **Mana base** counts the sources that produce each colour
against what the deck actually demands and when, using Frank Karsten's 90% numbers scaled to the
deck's size, and names the card that sets each bar. Sources come from basic land types and from
what a land's rules text says it adds; anything unreadable counts as nothing, so it errs toward
telling you you're short rather than telling you a broken base is fine.

**Table record.** The Life Counter has a *Decks* button: name the deck in each seat, and when the
game ends the result is filed against those decks. The deck page then shows what it has actually
done — wins, losses, win rate, when it last hit the table, and its head-to-head against every deck
it has faced — and the deck list shows each deck's W–L. Games are kept in your vault, newest
first, capped at 400. Nothing else does this, because nothing else is both your deck builder and
the life counter you play with.

**Trade binder and playgroup.** Tick *Up for trade* on any card (or a whole selection) and it joins
your trade list without moving anywhere. Sharing that list is its own switch in Settings, separate
from the read-only collection: once shared it appears on your wishlist page and in your playgroup's
matches. The **Playgroup** tab then reads the pages the other people on this server (those with a
public handle) already publish — their wishlist, and their trade list if they share one — and works out who has what:
what they want that you own (marked when it's already on your trade list), and what you want that
they'll trade, with a swap badge when it runs both ways. It never touches
anyone's vault; an unshared page just means no match. Proxies are never offered as matches,
since a proxy is a card you're still looking for.

**Wishlist.** The fourth tab is the list of cards you're hunting for, and it's the one thing
here that can be read without signing in (once you've picked a public handle). Add a card by name, pick the exact printing you want
(or say any printing is fine), set how many, how badly you want it, and a note. Cards you
already own can join the list too: tick *Want a real copy* on any card and it appears under
"Cards to replace" — which is mostly what proxies are for. The tab shows the public link,
`/w/<your handle>`, with a copy button; that page shows the wanted cards, their current market
price for reference, your notes, and links to Cardmarket and Scryfall, and nothing else about
your collection. *Got it* moves an entry into a collection of your choosing as a real card.

**Guest view.** A second address that needs no sign-in: `/v/<handle>` shows your collection
read-only. It's off until you switch it on in Settings, under "Share your collection", and while
it's off that address answers exactly like a profile that doesn't exist — so it can't be used to
find out who's here. A guest gets the cards (with the same search syntax you use), the sets you
own cards from, and your decks, all priced at today's rates. A guest never gets what you paid,
your collection totals, your gain, your value history, where a card is kept, your tags and notes,
or anything you've sold: the payload is built from an explicit allow-list in `public-vault.cjs`,
the same discipline as the wishlist page, so a card field added next year stays private until
someone deliberately lists it. The page itself has no way to change anything — no steppers, no
add, no settings, no save path. 
**Proxies.** Tick *Proxy* on any card and it stays in your collection, in your decks, and in
your grid — but it carries no value, takes no share of its collection's purchase total, and
Sets keeps counting the real card as missing (so cost-to-complete still quotes you for it).
Its tile reads NO VALUE and wears a PROXY badge instead of a price, and there's a Proxies chip
in the filter row for "what am I still running fake". Adding a real copy of a card you proxy
creates its own row rather than bumping the proxy's quantity, so the fake and the real never
merge. Proxy is also a bulk edit, for when a whole borrowed deck arrives at once.

**Searching by what a card does.** The collection search box matches the words printed on a
card, not just its name — search *venture into the dungeon* and you get every card that does
it. It reads the same locally cached rules text the glossary and the card zoom already use, so
cards you've looked at are searchable offline; the first search of a session scans anything
still missing in the background. The toggle in the search box switches between *Name + text*
and *Name*.

**Life Counter.** Full screen, 2–10 players, Commander or Normal. Per-opponent commander
damage with a lethal highlight, counted **per commander**: assign a partner deck to a seat and
it shows two commanders (A / B), each with its own damage tally against every opponent, and in
your own seat you pick which commander is dealing it; optional table-wide counters (poison, energy, experience,
commander tax, storm); tap a life total to type an exact number or hold ± to run it down;
monarch, initiative and day/night markers; d4–d20, a coin flip and a *Who starts* roll that
rerolls ties; knock seats out and it calls the winner; undo and a game log. Seats are drawn as flat slate panels with notched corners and a night-sky background option, in the same style as the rest of the app. It's deliberately
the one part of the app that shares only primitives with the rest — React, icons, design tokens and the shared UI shell — so it can be picked up and worked on on its own. Every
control is a button, because a dropdown is the wrong thing to hand someone across a table.

**Export.** *Export* asks who the file is for. **Binderwyrm** writes everything — cost basis,
sold history, proxy and wishlist flags, in your display currency — and is the one this app
reads back in full. **Archidekt**, **Moxfield** and **ManaBox** each write that site's own
column names, condition words and finish vocabulary, so their importers map the file without
you matching columns by hand; prices in those go out in USD, because that's what those
importers assume. **Decklist text** writes `1 Sol Ring (LTC) 59` per line — the list format
Archidekt, Moxfield, playgroup.gg and most other sites accept when you paste cards in. You
choose whether proxies and sold cards come along (proxies default off for the third-party
formats, since the other site would count them as cards you own — except Moxfield, which has
a proxy column of its own), and the first lines of the actual file are previewed before you
download.

**Charts.** Colour identity by value, your ten most valuable cards, paid-vs-worth per collection, value over time, mana curve, and value by rarity. All of them follow the active filter, so selecting one deck gives you that deck's curve.

**Bulk editing.** *Select* switches the grid into selection mode. Select all shown, select everything, invert, or shift-click to grab a range. Then reassign collection, set a physical location, change condition or foil across the batch — or delete it.

**Currency.** USD, EUR or CZK. The rates look after themselves: on boot, if what's on file
is more than twelve hours old, the browser fetches the European Central Bank's daily
reference rates (Frankfurter, falling back to open.er-api.com — both keyless, both fetched
client-side, so nothing about your collection goes anywhere). Settings shows when they last
updated, has an *Update now* button, and a tick-box to go back to typing them by hand. If
neither source answers, the last known rates stay and Settings says so. Every amount is stored internally in USD and converted for display, and every input is labelled with the active currency — type 1499 with CZK selected and you've recorded 1499 Kč, not $1499. CSV import asks which currency the file's prices are in; export writes in your display currency with the code in the column headers.

With the default price source, EUR is Cardmarket's own price where Scryfall has one; CZK and anything else is a conversion at the reference rate. The rate is memoised against a `moneyKey`, so changing currency or rates repaints every price at once.

**Selling.** Open a card and hit *Sell* to record what you got for it and when. It moves to the Sold shelf, keeps its share of what you originally paid, and the difference lands in the header as **Realized** gain or loss — separate from the unrealized figure for what you still hold. Sold cards are excluded from holdings totals and charts. *Put back in collection* undoes it.

**Physical location.** A free-text field per card ("Binder 2, page 4"), editable individually or in bulk, shown on the card and included in exports.

---

## The look

**Ink & Slate**: flat, opaque surfaces on near-black, one slate-blue accent, corners cut at 45° ("notched") on panels and controls while card images keep their real rounded corners. No blur, glow or gradient text. Cinzel carries headings and labels, Spectral card names, IBM Plex Mono the figures — all self-hosted, so the app makes no request to Google Fonts. Rarity colours (gold rare, orange mythic) are used strictly as data.

## A note on prices

Prices come from [Scryfall](https://scryfall.com), which aggregates TCGplayer and Cardmarket. They're indicative market prices, not what you'd actually clear on a sale after fees and condition. Treat the totals as a running appraisal rather than an offer.

The app respects Scryfall's rate guidance with a 100ms delay between requests and uses their batch endpoint wherever possible. Please don't lower that.

### The local card database

When the app runs with `server.cjs` (Docker or `npm start`), the server keeps its own copy of
Scryfall's card data so lookups don't wait on api.scryfall.com. Scanning a card, searching in
*Add a card*, picking a printing, CSV/paste/deck imports and the price refresh all ask the
server first. A scanned code comes back in a few milliseconds instead of a round trip to
Scryfall, and a 1,000-card import is matched without any network traffic at all.

- **What it downloads:** Scryfall's daily "Default Cards" bulk file (one entry per printing),
  about 500 MB. The server trims it to the fields the app uses and keeps that (about 130 MB)
  under `DATA_DIR/cards/`. It checks once a day and only downloads again when Scryfall has
  published new data. The index takes about 65 MB of the server's memory.
- **First start:** the download takes a minute or two. Until it finishes, and whenever the
  local copy can't answer (a card released since this morning's data, or search syntax it
  doesn't understand, such as `o:` or `cmc>=3`), the app asks Scryfall directly, exactly as
  it did before. A local answer is only ever a faster version of the same answer.
- **Turning it off:** set `CARD_DB=off` in the environment (e.g. under `environment:` in
  `docker-compose.yml`). The app then talks to Scryfall directly for everything.
- `GET /api/cards/status` shows whether it's ready, how many printings it holds, and the
  date of Scryfall's data.

---

## Project layout

```
binderwyrm/
├── index.html              entry point (also where the Google Fonts stylesheet loads)
├── package.json
├── vite.config.js
├── start.bat               Windows launcher
├── server.cjs              static hosting + per-profile storage
├── public-wishlist.cjs     the allow-list for the PIN-free wishlist endpoint
├── public-vault.cjs        the allow-list for the PIN-free read-only collection
├── admin.cjs               the /admin API (settings, accounts, restart)
├── settings.cjs            settings saved by the admin page (DATA_DIR/config.json)
├── safe-url.cjs            keeps public pages to Scryfall links/images
├── cards-db.cjs            local copy of Scryfall's card data (daily bulk download + index)
├── auth-accounts.cjs       accounts, sessions, lockout, rate limits (SQLite)
├── totp.cjs                two-factor codes and recovery codes
├── mailer.cjs              optional SMTP for sign-in / reset mail
├── legacy-profiles.cjs     reads the old PIN profiles so they can be claimed
├── pin-guard.cjs           wrong-PIN throttling (legacy profile claims)
├── capacitor.config.json   phone app id, name and colours (see MOBILE.md)
├── native/live-scanner/    the phone app's camera scanner plugin (ML Kit / Apple Vision)
├── android/                Android Studio project for the phone app
├── ios/                    Xcode project for the phone app
├── sample-collection.csv   example import file
├── scripts/
│   └── run-tests.mjs       runs every *-test.jsx in one pass (npm test)
└── src/
    ├── main.jsx            React bootstrap
    ├── index.css           global reset
    ├── App.jsx             orchestrator: top-level state, persistence, the view switch
    ├── lib/                framework-free helpers shared across features (Scryfall
    │                       fetch/cache, formatting, the store persistence shim, tokens,
    │                       formats.js for legality/banlists, tags.js, buyLinks.js,
    │                       precons.js, collectionTree.js, commander.js, brackets.js,
    │                       router.js, liveScan.js/ocr.js for the scanner)
    ├── components/ui/      small shared building blocks (ModalShell, Field, Stepper, ...)
    └── features/
        ├── auth/           sign-in, account menu, two-factor, devices
        ├── admin/          the /admin page
        ├── collection/     the default view: grid, filters, card tile, and its modals
        │                   (query.js holds the search syntax - a pure parser, no React)
        ├── decks/          Commander + 60-card deck builder (goldfish.js, manabase.js
        │                   and record.js are pure; categories.js for a
        │                   deck's own groups, commanderPicker.js, externals.js for
        │                   cards you don't own yet)
        ├── sets/           set-completion tracker + Art Cards sub-tab
        ├── wishlist/       the wishlist tab, its add dialog, and the public
        │                   /w/<profile> page (rendered straight from main.jsx,
        │                   so a visitor never touches the profile gate)
        ├── vault/          the read-only /v/<profile> guest view
        ├── playgroup/      wants-vs-haves matching across the profiles on this server
        ├── glossary/       keyword glossary
        └── life/           the Life Counter (LifeCounterView + lifeState.js,
        │                   which holds the rules) - deliberately self-contained (only
                            imports React + shared UI primitives, nothing from
                            collection/decks/store) so it's easy to expand on its own
```

Used to be one 12,500-line `App.jsx`; it's now split into the module tree above, with
each of Sets/Decks/Glossary/Life Counter/Analytics/Import/Settings loaded on demand via
`React.lazy()` instead of shipping in the initial bundle — see the "Load-time fix" note
`git log` will show around this change for the before/after numbers. `App.jsx` itself is
now the thin orchestrator: top-level state, the localStorage/server persistence layer,
and the view switch that lazily mounts whichever feature is active.

Run `npm test` before shipping a change - it esbuild-bundles and runs every `*-test.jsx`
smoke test in one pass and reports a pass/fail summary (this replaces running
`deck-click-test.jsx` by hand per SYNC.md's older instructions, though that still works
too).

---

## Provenance

This project was written by [Claude](https://claude.com) (Anthropic's AI assistant), built
iteratively in conversation with, and directed by, Michael Ondráček — who chose the features,
the design direction, and did the real-world testing. Treat the code accordingly: it has been
exercised by its author and works for its purpose, but it has not been through independent
human code review. Bug reports welcome.

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, host it for your playgroup.

Magic: The Gathering is a trademark of Wizards of the Coast; this is an unaffiliated fan-made
tool and includes no card images or text of its own — card data and prices are fetched at
runtime courtesy of [Scryfall](https://scryfall.com).
