# One server, email accounts

There used to be two editions: a self-hosted PIN edition and an accounts edition behind
`AUTH_MODE=accounts`. PIN profiles were retired; the server now only does email accounts
(`server.cjs` → `auth-accounts.cjs`, SQLite in `DATA_DIR/accounts.db`). Old PIN profile files
under `DATA_DIR/profiles/` are read through `legacy-profiles.cjs`, only so their owners can claim
them into an account (`POST /api/auth/claim`); nothing ever writes to them.

The client asks `GET /api/health`, which returns `mode: "accounts"` and `claim: true` while
unclaimed profiles remain, and shows `AuthGate.jsx`. `src/features/auth/` only talks to the
backend through `/api/health`, `/api/auth/*` and the `store` object (`src/lib/store.js`). Keep it
that way.

The phone app signs in with a bearer token instead of the cookie (see `auth-accounts.cjs`, and
`authHeaders()` in `src/lib/platform.js`). Public pages (`/w/<handle>`, `/v/<handle>`) and the
playgroup list work off the account's optional public handle.

Before packaging:

```bash
npm run build   # must succeed
npm test        # esbuild-bundles and runs every *-test.jsx, must report all passing
```

`accounts-server-test.jsx` runs the accounts edition end to end against a fake SMTP
server. `accounts-app-test.jsx` covers the client side, in the phone app and in a browser.
