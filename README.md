# HoardKeeper

A self-hosted Magic: The Gathering collection tracker with a soul. Add cards, watch their
market value move, record what you actually paid for boosters and precons, track set
completion, draft Commander and 60-card decks from what you own, and share the vault with
your playgroup through named profiles.

Runs in your browser against Scryfall's public API. Standalone it needs no account and no
server — collections live in localStorage; the bundled Node server adds per-person profiles
for a shared install. No telemetry either way.

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

### Hosting it on Server (Docker + Proxy)

The repo ships a small Node server (`server.cjs`) that serves the built app **and** stores each
person's collection in a named profile on the server, so vaults follow people rather than
browsers.

```bash
docker compose up -d --build
```

That builds the image and runs it on **port 8420** with profile data in `./data` — back that
folder up like anything else. Add a proxy rule:

- Host: `hoard.your-domain.eu` (add a matching record if your DNS isn't a wildcard)
- Target: `http://XX.XX.XX.XX:8420`



### Profiles

When the app is served by `server.cjs` it opens with a profile picker: each friend creates a
named vault with an optional PIN, and their collection lives server-side under that name.
Settings shows who's signed in and lets you switch. Without the server (plain `npm run dev`
or static hosting), the app quietly falls back to browser localStorage exactly as before.

Be honest with your friends about what the PIN is: casual protection between people who
already trust each other, hashed at rest but with no rate limiting or sessions.

### Building a static copy

```powershell
npm run build
```

The output lands in `dist/` as plain HTML/CSS/JS. Copy that folder anywhere that serves static files — IIS, nginx, Caddy, or behind Zoraxy. `vite.config.js` sets `base: "./"`, so it works from a subpath without further configuration.

---

## Where your data lives

Everything is kept in your browser's `localStorage`, under the key `ledger-foil-data`.

That means:

- Your collection is tied to **that browser on that machine**. Opening the app in a different browser shows an empty vault.
- Clearing site data or browsing history will wipe it.
- Private/incognito windows won't persist anything.

**Use Export CSV as your backup.** It writes every card with its collection, allocated cost and current value, and you can re-import that file at any time. Do it before you clear anything.

If you later want the collection to follow you across machines, the storage layer is a single `store` object at the top of `src/App.jsx` with `get` and `set` methods — point those at a small API or a Postgres-backed endpoint and nothing else has to change.

---

## Features

**Adding cards.** Search by name against Scryfall and it fills in set, art, current price, colours, rarity and mana value. Optionally pin the set code to get a specific printing. Manual entry is there for anything Scryfall doesn't know about.
<img width="379" height="752" alt="image" src="https://github.com/user-attachments/assets/fa0cd7b5-283a-4d9d-bc51-783ded251e00" />

**Collections and cost basis.** Create a collection for a purchase — a Commander precon, a bundle, a booster box — and give it the total you paid. That cost is split evenly across the cards you assign to it, so every card carries a share of what the product cost. Override any individual card when the even split isn't right (the chase rare in a bundle, say), and the remainder redistributes across the rest automatically.

<img width="1491" height="801" alt="image" src="https://github.com/user-attachments/assets/6cbf1700-0f37-4a54-aa2d-4bfc5425ebe1" />

The **Collections** button in the header opens the manager: rename a collection, edit what you invested in it, see its current value and gain side by side, reset a total back to zero, or delete it (its cards fall back to Uncategorized). *Reset all invested* clears every total at once if you want to re-enter your cost basis from scratch.

**CSV import.** Works with ManaBox, Moxfield, Deckbox and TCGplayer exports. It reads your header row, guesses which column is which, and shows you the mapping so you can correct it before importing. Each distinct value in your collection/binder column becomes a real collection, and if the file has purchase prices they're summed into that collection's total. Matching goes through Scryfall's batch endpoint — 75 cards per request, using Scryfall ID where your file has one, otherwise set + collector number, otherwise name. Anything the batch misses gets a fuzzy retry.

Turn the lookup off and the import is instant and offline, using only what's in the file. Map a "Current value" column and your collection is fully valued without touching the network.

`sample-collection.csv` in this folder shows the expected shape.

**Price tracking.** *Refresh prices* re-checks the whole collection in batches. Each refresh stores a dated snapshot, which feeds the value-over-time chart, and records the previous price per card, which feeds the Movers list — what gained and what dropped since you last looked. Snapshots are one per day, last 180 kept.

**Sets.** The second tab tracks completion, MTG Collection Builder-style. Every set you own cards from is listed with a completion percentage; expanding one loads the full roster from Scryfall (cached locally for a week) and shows per-rarity progress bars plus every card in the set with a +/− quantity stepper — tap through a booster box without opening a single dialog. New cards created from the roster land in whichever collection you pick in the roster header. Filter the roster to All / Missing / Owned, search within it, and jump to Cardmarket from any row.

**Decks.** The third tab is a Commander deck builder that works from what you own. Pick any legendary creature in your collection as commander and hit *Auto-build*: the drafter fetches your cards' rules text from Scryfall (cached locally), classifies every card in the commander's color identity by role — lands, ramp, draw, removal, board wipes — fills sensible quotas (37 lands, 10 ramp, 10 draw, 8 removal, 3 wipes), scores the rest by synergy with the commander's text and creature types, and tops up the mana base with basic lands split by your color pips. Singleton and color identity are enforced. The result lands in role columns you can prune by hand, with a search box to add anything in-identity from your collection, a running deck value, and one-click decklist export for Moxfield or Archidekt. Re-draft any time — it's a starting 100, not gospel: the drafter reads rules text, not the meta, so treat it as a fast first pass to tune at the table.

<img width="614" height="316" alt="image" src="https://github.com/user-attachments/assets/5d02bd8f-0951-4e4d-8ce5-abede345a3ff" />


A 60-card constructed mode sits alongside it: pick one or two colors instead of a commander, and the drafter builds toward 24 lands with up to four copies of a card — never more than you own — inferring a theme from your most common creature type. Deck rows get ×-count steppers, and export writes proper `4 Lightning Bolt` lines.

**Charts.** Colour identity by value, your ten most valuable cards, paid-vs-worth per collection, value over time, mana curve, and value by rarity. All of them follow the active filter, so selecting one deck gives you that deck's curve.

<img width="1165" height="650" alt="image" src="https://github.com/user-attachments/assets/0cb3bb52-7e24-4ca5-9e6e-5b3bc9e4c68e" />


**Bulk editing.** *Select* switches the grid into selection mode. Select all shown, select everything, invert, or shift-click to grab a range. Then reassign collection, set a physical location, change condition or foil across the batch — or delete it.

**Currency.** USD, EUR or CZK, with rates you set yourself. Every amount is stored internally in USD and converted for display, and every input is labelled with the active currency — type 1499 with CZK selected and you've recorded 1499 Kč, not $1499. CSV import asks which currency the file's prices are in; export writes in your display currency with the code in the column headers.

Scryfall quotes in USD, so EUR and CZK are conversions at your rate rather than Cardmarket prices — worth remembering if you're comparing against a European listing.

**Selling.** Open a card and hit *Sell* to record what you got for it and when. It moves to the Sold shelf, keeps its share of what you originally paid, and the difference lands in the header as **Realized** gain or loss — separate from the unrealized figure for what you still hold. Sold cards are excluded from holdings totals and charts. *Put back in collection* undoes it.

**Physical location.** A free-text field per card ("Binder 2, page 4"), editable individually or in bulk, shown on the card and included in exports.

---

## The look

The interface is a playmat: graphite felt with a silver-stitched border, cards rendered as sleeved objects that lift on hover, and every caption set on white card stock — the card frame's own type-line bar, reused as UI. Cinzel carries the headings, Spectral the card names, IBM Plex Mono the figures. Rarity colours (gold rare, orange mythic) are the only warm metals left, used strictly as data.

## A note on prices

Prices come from [Scryfall](https://scryfall.com), which aggregates TCGplayer and Cardmarket. They're indicative market prices, not what you'd actually clear on a sale after fees and condition. Treat the totals as a running appraisal rather than an offer.

The app respects Scryfall's rate guidance with a 100ms delay between requests and uses their batch endpoint wherever possible. Please don't lower that.

---

## Project layout

```
ledger-and-foil/
├── index.html              entry point
├── package.json
├── vite.config.js
├── start.bat               Windows launcher
├── sample-collection.csv   example import file
└── src/
    ├── main.jsx            React bootstrap
    ├── index.css           global reset
    └── App.jsx             the entire application
```

`App.jsx` is one file by design — easy to read top to bottom, easy to grep. The Scryfall helpers and the `store` shim sit at the top, the `App` component holds all state, and the UI components follow beneath it.

---

## Provenance

This project was written by [Claude](https://claude.com) (Anthropic's AI assistant), built
iteratively in conversation with, and directed by, Michael Arin — who chose the features,
the design direction, and did the real-world testing. Treat the code accordingly: it has been
exercised by its author and works for its purpose, but it has not been through independent
human code review. Bug reports welcome.

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, host it for your playgroup.

Magic: The Gathering is a trademark of Wizards of the Coast; this is an unaffiliated fan-made
tool and includes no card images or text of its own — card data and prices are fetched at
runtime courtesy of [Scryfall](https://scryfall.com).

## Tips

Feel free to support getting treats for my doggo. https://ko-fi.com/arinlir
