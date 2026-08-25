# Keeping the two projects in step

`src/` is **identical** in the self-hosted and cloud projects, on purpose. The app asks
the server which sign-in it runs (`GET /api/health` returns `mode: "pin"` or `"accounts"`)
and shows the matching gate (`src/features/auth/AuthGate.jsx` / `ProfileGate.jsx`).
Everything else — collection, sets, decks, glossary, life — is the same code.

`src/App.jsx` used to be the whole app in one file, so syncing was a single-file diff.
It's now split into a module tree (`src/lib/`, `src/components/ui/`, `src/features/**`)
with `App.jsx` reduced to the orchestrator, so syncing is a whole-`src/`-tree copy
instead:

```bash
rm -rf hoardkeeper-cloud/src
cp -r hoardkeeper/src hoardkeeper-cloud/src
diff -rq hoardkeeper/src hoardkeeper-cloud/src   # must be silent
```

`src/features/auth/` is the one area to double check after a sync touches it — it's
shared code, but it's also the seam between the two projects' different backends (PIN
profiles vs. real accounts). It talks to the backend only through `/api/health`,
`/api/auth/*` and the `store` object's `mode` (`"local" | "server" | "accounts"`,
`src/lib/store.js`), never anything self-hosted- or cloud-specific directly — keep it
that way rather than letting either backend's assumptions leak in.

What actually differs between the projects:

| | Self-hosted | Cloud |
|---|---|---|
| `server.cjs` | PIN profiles, JSON files | delegates to `auth-accounts.cjs` |
| `auth-accounts.cjs` | absent | accounts, sessions, SQLite |
| `.env.example` | absent | required config |
| `LICENSE` | MIT | none (private) |
| `README.md` | public docs | operator docs |

Before packaging either one:

```bash
npm run build   # must succeed
npm test        # esbuild-bundles and runs every *-test.jsx, must report all passing
```

`npm test` (`scripts/run-tests.mjs`) replaces running individual test files by hand — it
loops every `*-test.jsx` in the repo root the same way the old one-off recipe did:

```bash
npx esbuild deck-click-test.jsx --loader:.jsx=jsx --bundle --format=esm \
  --outfile=./dc.mjs --external:jsdom && node ./dc.mjs && rm dc.mjs
```

`deck-click-test.jsx` specifically mounts the deck view in jsdom and clicks through it —
it exists because a server-render smoke test only reaches the boot screen and will
happily pass while the deck page is crashing. It's one of the 32 files `npm test` runs.
