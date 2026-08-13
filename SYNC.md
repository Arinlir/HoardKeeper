# Keeping the two projects in step

`src/App.jsx` is **identical** in the self-hosted and cloud projects, on purpose. The app
asks the server which sign-in it runs (`GET /api/health` returns `mode: "pin"` or
`"accounts"`) and shows the matching gate. Everything else — collection, sets, decks,
glossary — is the same code.

So syncing an app change is a file copy, not a merge:

```bash
cp hoardkeeper/src/App.jsx hoardkeeper-cloud/src/App.jsx
diff hoardkeeper/src/App.jsx hoardkeeper-cloud/src/App.jsx   # must be silent
```

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
npm run build                                   # must succeed
node --experimental-strip-types deck-click-test.jsx   # or the esbuild route below
```

```bash
npx esbuild deck-click-test.jsx --loader:.jsx=jsx --bundle --format=esm \
  --outfile=./dc.mjs --external:jsdom && node ./dc.mjs && rm dc.mjs
```

`deck-click-test.jsx` mounts the deck view in jsdom and clicks through it. It exists
because a server-render smoke test only reaches the boot screen and will happily pass
while the deck page is crashing.
