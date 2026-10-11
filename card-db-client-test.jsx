// Verifies: every Scryfall helper asks the server's local card database
// first (/api/cards, see cards-db.cjs) and only goes to api.scryfall.com when
// the local copy can't answer — not ready, turned off, no server, a miss, or
// search syntax it doesn't evaluate. Scanning (by code), Add a card (search +
// printings), imports and price refresh (collection) all ride on these.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const S = await import("./src/lib/scryfall.js");

const raw = (o) => ({
  id: o.id || `id-${o.set}-${o.collector_number}`,
  name: o.name,
  set: o.set,
  set_name: o.set.toUpperCase(),
  collector_number: o.collector_number,
  image_uris: { normal: "n.jpg", large: "l.jpg" },
  prices: { usd: "1.00" },
  type_line: "Instant",
  rarity: "common",
  released_at: "2020-01-01",
  ...o,
});
const res = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

let calls = [];
let localReady = true;
let localHandler = () => res(404, {});
let remoteHandler = () => res(404, {});
globalThis.fetch = (url, opts) => {
  const u = String(url);
  calls.push({ u, body: opts?.body ? JSON.parse(opts.body) : null });
  if (u === "/api/cards/status") return localReady === "down" ? Promise.reject(new Error("no server")) : res(200, { ready: localReady === true });
  if (u.startsWith("/api/cards/")) return localHandler(u, opts);
  if (u.startsWith("https://api.scryfall.com/")) return remoteHandler(u, opts);
  return res(404, {});
};
const remoteCalls = () => calls.filter((c) => c.u.startsWith("https://api.scryfall.com/"));
const localCalls = () => calls.filter((c) => c.u.startsWith("/api/cards/") && c.u !== "/api/cards/status");
const fresh = () => {
  S.resetLocalCards();
  calls = [];
};

// ---- 1. scan: set + number answered locally ----
fresh();
localReady = true;
localHandler = (u) =>
  u === "/api/cards/code/sld/0191" ? res(200, raw({ name: "Lightning Bolt", set: "sld", collector_number: "0191" })) : res(404, {});
let c = await S.scryfallByCode("SLD", "0191");
check("scan lookup is answered by the local database", c.name === "Lightning Bolt" && c.set === "sld");
check("...without touching Scryfall", remoteCalls().length === 0);
check("the readiness check happens once, not per lookup", (await S.scryfallByCode("sld", "0191"), calls.filter((x) => x.u === "/api/cards/status").length === 1));

// a card newer than today's copy: local 404 → Scryfall
calls = [];
remoteHandler = (u) => (u.endsWith("/cards/new/1") ? res(200, raw({ name: "Brand New", set: "new", collector_number: "1" })) : res(404, {}));
c = await S.scryfallByCode("NEW", "1");
check("a local miss falls back to Scryfall", c.name === "Brand New" && remoteCalls().length === 1);
let threw = null;
try {
  await S.scryfallByCode("zzz", "9");
} catch (e) {
  threw = e.message;
}
check("a miss everywhere still says which card wasn't found", /No card 9 in set ZZZ/.test(threw || ""));

// ---- 2. names ----
fresh();
localHandler = (u) =>
  u.startsWith("/api/cards/named?fuzzy=lightnin%20bolt") ? res(200, raw({ name: "Lightning Bolt", set: "m11", collector_number: "149" })) : res(404, {});
c = await S.scryfallLookup("lightnin bolt");
check("fuzzy name lookup is local", c.set === "m11" && remoteCalls().length === 0);
calls = [];
localHandler = (u) => (u === "/api/cards/named?fuzzy=Nope&set=lea" ? res(404, {}) : res(500, {}));
remoteHandler = () => res(404, { details: "nope" });
threw = null;
try {
  await S.scryfallLookup("Nope", "lea");
} catch (e) {
  threw = e.message;
}
check("name lookup passes the set through and falls back on a miss", localCalls().length === 1 && remoteCalls().length === 1 && /Card not found/.test(threw || ""));

// ---- 3. search (Add a card, wishlist, printings pickers) ----
fresh();
localHandler = (u) => {
  const q = new URL(u, "http://x").searchParams;
  if (q.get("q") === "bolt" && q.get("page") === "2") return res(200, { data: [raw({ name: "Bolt Two", set: "x", collector_number: "2" })], total_cards: 400, has_more: false });
  if (q.get("q") === "bolt" && q.get("unique") === "cards")
    return res(200, { data: [raw({ name: "Lightning Bolt", set: "m11", collector_number: "149" })], total_cards: 400, has_more: true });
  if (q.get("q") === "o:damage") return res(422, { error: "Query not supported locally" });
  return res(200, { data: [], total_cards: 0, has_more: false });
};
remoteHandler = (u) => res(200, { data: [raw({ name: "From Scryfall", set: "sf", collector_number: "1" })], total_cards: 1, has_more: false });
let page = await S.scryfallSearchPage("bolt");
check("a search page comes from the local copy with Scryfall's paging fields", page.cards[0].name === "Lightning Bolt" && page.total === 400 && page.hasMore === true);
page = await S.scryfallSearchPage("bolt", { page: 2 });
check("...and so does the next page", page.cards[0].name === "Bolt Two" && remoteCalls().length === 0);
page = await S.scryfallSearchPage("o:damage");
check("syntax the local copy doesn't evaluate goes to Scryfall", page.cards[0].name === "From Scryfall");
calls = [];
page = await S.scryfallSearchPage("brandnewcard");
check("an empty local result gets a second opinion from Scryfall", page.cards[0].name === "From Scryfall" && remoteCalls().length === 1);
calls = [];
const small = await S.scryfallSearch("bolt", "cards", 1);
check("scryfallSearch uses the local copy and respects its limit", small.length === 1 && small[0].name === "Lightning Bolt" && remoteCalls().length === 0);

// ---- 4. collection (imports, deck import, price refresh) ----
fresh();
localHandler = (u, opts) => {
  const ids = JSON.parse(opts.body).identifiers;
  const data = [];
  const not_found = [];
  ids.forEach((i) => (i.name === "Lightning Bolt" || i.set === "isd" ? data.push(raw({ name: i.name || "Delver", set: i.set || "m11", collector_number: i.collector_number || "149" })) : not_found.push(i)));
  return res(200, { object: "list", data, not_found });
};
let remoteBodies = [];
remoteHandler = (u, opts) => {
  const ids = JSON.parse(opts.body).identifiers;
  remoteBodies.push(ids);
  return res(200, { data: ids.filter((i) => i.name === "Brand New").map((i) => raw({ name: i.name, set: "new", collector_number: "1" })), not_found: ids.filter((i) => i.name !== "Brand New") });
};
let col = await S.scryfallCollection([{ name: "Lightning Bolt" }, { set: "isd", collector_number: "51" }, { name: "Brand New" }, { name: "Typo Card" }]);
check("a batch is resolved locally first", col.data.length === 3);
check("only the local misses are sent to Scryfall", remoteBodies.length === 1 && remoteBodies[0].length === 2 && remoteBodies[0][0].name === "Brand New");
check("what neither found is reported as not_found", col.not_found.length === 1 && col.not_found[0].name === "Typo Card");
calls = [];
remoteBodies = [];
col = await S.scryfallCollection([{ name: "Lightning Bolt" }]);
check("a fully local batch never calls Scryfall", remoteCalls().length === 0 && col.data.length === 1 && col.not_found.length === 0);

// Scryfall down, local found some: keep what we have
remoteHandler = () => Promise.reject(new Error("offline"));
col = await S.scryfallCollection([{ name: "Lightning Bolt" }, { name: "Typo Card" }]);
check("if Scryfall is unreachable the local finds still come back", col.data.length === 1 && col.not_found.length === 1);

// ---- 5. local database not ready / no server ----
fresh();
localReady = false;
remoteHandler = (u) => res(200, raw({ name: "Lightning Bolt", set: "lea", collector_number: "161" }));
c = await S.scryfallByCode("lea", "161");
check("while the server is still downloading, lookups go straight to Scryfall", c.set === "lea" && localCalls().length === 0);
await S.scryfallByCode("lea", "161");
check("...and the server isn't re-asked on every lookup", calls.filter((x) => x.u === "/api/cards/status").length === 1);

fresh();
localReady = "down";
c = await S.scryfallByCode("lea", "161");
check("no server at all (vite dev, static hosting): Scryfall as before", c.set === "lea");

// server says ready, then restarts with CARD_DB=off mid-session
fresh();
localReady = true;
localHandler = () => res(503, { error: "Card database disabled" });
c = await S.scryfallByCode("lea", "161");
check("a 503 from the local database falls back to Scryfall", c.set === "lea");
calls = [];
await S.scryfallByCode("lea", "161");
check("...and stops asking it for a while", localCalls().length === 0);

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
