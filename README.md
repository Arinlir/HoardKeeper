# HoardKeeper

A self-hosted Magic: The Gathering collection tracker with a soul. Add cards, watch their
market value move, record what you actually paid for boosters and precons, track set
completion, draft Commander and 60-card decks from what you own, and share the vault with
your playgroup through named profiles.

Main reason I had this constructed is because each tool I found was just lacking something. Certain box of mana is great for scanning, but clarity over my collection was just lacking(price tagging when I bought boosters and not just single cards, etc.)

Runs in your browser against Scryfall's public API. Standalone it needs no account and no
server — collections live in localStorage; the bundled Node server adds per-person profiles
for a shared install. No telemetry either way.

See [FEATURES.md](FEATURES.md) for the full feature list.

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

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, host it for your playgroup.

Magic: The Gathering is a trademark of Wizards of the Coast; this is an unaffiliated fan-made
tool and includes no card images or text of its own — card data and prices are fetched at
runtime courtesy of [Scryfall](https://scryfall.com).

## Tips

Feel free to support getting treats for my doggo. https://ko-fi.com/arinlir
