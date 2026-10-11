// Verifies: the server's local card database (cards-db.cjs) — downloading
// Scryfall's bulk file, trimming it, indexing it, answering the /api/cards
// routes the client uses, and swapping in a new day's data without dropping
// the old one on failure. A fake Scryfall on localhost stands in for the real
// one, serving the bulk file gzipped and in awkward chunk sizes on purpose.
import http from "node:http";
import zlib from "node:zlib";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// Loaded at runtime rather than bundled — it's a server module using node builtins.
const load = createRequire(import.meta.url);
const { createCardDb, parseQuery, trimCard } = load(path.join(process.cwd(), "cards-db.cjs"));

// ---- a small Scryfall-shaped card pool ----
let n = 0;
const card = (o) => ({
  object: "card",
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  lang: "en",
  layout: "normal",
  multiverse_ids: [1],
  rulings_uri: "https://api.scryfall.com/cards/x/rulings",
  image_uris: { small: "s.jpg", normal: `n-${n}.jpg`, large: `l-${n}.jpg`, png: `p-${n}.png`, art_crop: "a.jpg" },
  mana_cost: "{R}",
  cmc: 1,
  type_line: "Instant",
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  colors: ["R"],
  color_identity: ["R"],
  legalities: { commander: "legal", modern: "legal" },
  games: ["paper"],
  finishes: ["nonfoil", "foil"],
  promo: false,
  digital: false,
  set_type: "core",
  rarity: "common",
  prices: { usd: "1.00", usd_foil: "2.00", eur: "0.90", tix: "0.02" },
  purchase_uris: { tcgplayer: "x" },
  ...o,
});
const POOL = [
  card({ name: "Lightning Bolt", set: "lea", set_name: "Alpha", collector_number: "161", released_at: "1993-08-05" }),
  card({ name: "Lightning Bolt", set: "m11", set_name: "Magic 2011", collector_number: "149", released_at: "2010-07-16" }),
  card({ name: "Lightning Bolt", set: "sld", set_name: "Secret Lair", set_type: "box", collector_number: "0191", promo: true, released_at: "2024-01-01" }),
  card({ name: "Lightning Bolt", set: "ya25", set_name: "Alchemy", digital: true, games: ["arena"], collector_number: "5", released_at: "2025-01-01" }),
  card({ name: "Lightning Helix", set: "rav", collector_number: "213", colors: ["R", "W"], rarity: "uncommon", released_at: "2005-10-07" }),
  card({
    name: "Delver of Secrets // Insectile Aberration",
    layout: "transform",
    image_uris: undefined,
    type_line: "Creature — Human Wizard // Creature — Human Insect",
    colors: undefined,
    set: "isd",
    collector_number: "51",
    released_at: "2011-09-30",
    card_faces: [
      { name: "Delver of Secrets", type_line: "Creature — Human Wizard", colors: ["U"], image_uris: { normal: "front.jpg", large: "front-l.jpg" } },
      { name: "Insectile Aberration", type_line: "Creature — Human Insect", colors: ["U"], image_uris: { normal: "back.jpg", large: "back-l.jpg" } },
    ],
  }),
  card({ name: "Goblin", layout: "token", set: "tm11", set_type: "token", type_line: "Token Creature — Goblin", collector_number: "1", released_at: "2010-07-16" }),
  card({ name: "Lim-Dûl's Vault", set: "all", collector_number: "23", colors: ["U", "B"], released_at: "1996-06-10" }),
  card({
    name: "Young Pyromancer",
    set: "m14",
    collector_number: "163",
    type_line: "Creature — Human Shaman",
    rarity: "uncommon",
    released_at: "2013-07-19",
    all_parts: [
      { id: "tok", component: "token", name: "Elemental", type_line: "Token Creature — Elemental", uri: "u" },
      { id: "m", component: "meld_part", name: "X", type_line: "Y", uri: "u" },
    ],
  }),
  card({ name: 'Tricky "Quotes" {Braces}', set: "lea", collector_number: "48", oracle_text: 'A } and a " and a \\ inside', released_at: "1993-08-05" }),
];

// ---- fake Scryfall ----
let updatedAt = "2026-09-26T09:00:00+00:00";
let bulkDownloads = 0;
let failIndex = false;
const gz = zlib.gzipSync("[\n" + POOL.map((c) => JSON.stringify(c)).join(",\n") + "\n]");
const fake = http.createServer((req, res) => {
  if (req.url === "/bulk-data/default-cards") {
    if (failIndex) {
      res.writeHead(500);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ updated_at: updatedAt, download_uri: `http://127.0.0.1:${fake.address().port}/bulk.json` }));
  }
  if (req.url === "/bulk.json") {
    bulkDownloads++;
    res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
    let o = 0;
    const step = () => {
      if (o >= gz.length) return res.end();
      res.write(gz.subarray(o, o + 333));
      o += 333;
      setImmediate(step);
    };
    return step();
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const BULK = `http://127.0.0.1:${fake.address().port}/bulk-data/default-cards`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "binderwyrm-cards-"));
const dir = path.join(tmp, "cards");

// ---- 1. trimming keeps what the client reads, drops the rest ----
const t = trimCard(POOL[8]);
check("trim keeps prices the app shows", t.prices.usd === "1.00" && t.prices.eur === "0.90" && !("tix" in t.prices));
check("trim keeps normal/large/png images, drops the other sizes", t.image_uris.normal && t.image_uris.large && t.image_uris.png && !t.image_uris.art_crop);
check("trim keeps token parts, drops meld parts", t.all_parts.length === 1 && t.all_parts[0].component === "token");
check("trim drops links the app never follows", !("rulings_uri" in t) && !("purchase_uris" in t) && !("multiverse_ids" in t));

// ---- 2. download + index ----
const db = createCardDb({ dir, bulkIndexUrl: BULK, log: () => {} });
check("not ready before anything is downloaded", db.status().ready === false);
await db.refresh();
check("ready after the download", db.status().ready === true && db.status().count === POOL.length);
check("status reports Scryfall's updated_at", db.status().updatedAt === updatedAt);

// ---- 3. lookups ----
check("by code", db.byCode("m11", "149")?.set === "m11");
check("by code ignores the set code's case", db.byCode("SLD", "0191")?.collector_number === "0191");
check("by code strips padding the card doesn't have", db.byCode("m11", "0149")?.set === "m11");
check("by code: unknown is null", db.byCode("lea", "999") === null);
check("by id", db.byId(POOL[4].id)?.name === "Lightning Helix");
check("text with quotes and braces survives the stream splitter", db.byCode("lea", "48")?.oracle_text === POOL[9].oracle_text);

check("named picks the paper, non-promo, newest printing", db.named({ fuzzy: "lightning bolt" })?.set === "m11");
check("named honours a set", db.named({ fuzzy: "Lightning Bolt", set: "lea" })?.set === "lea");
check("named forgives a typo", db.named({ fuzzy: "Lightnin Bolt" })?.name === "Lightning Bolt");
check("named ignores accents and punctuation", db.named({ fuzzy: "lim duls vault" })?.name === "Lim-Dûl's Vault");
check("named finds a two-faced card by its back face", db.named({ fuzzy: "Insectile Aberration" })?.set === "isd");
check("named leaves an ambiguous prefix to Scryfall", db.named({ fuzzy: "lightning" }) === null);
check("named exact is exact", db.named({ exact: "Lightning Helix" })?.set === "rav" && db.named({ exact: "Lightning Heli" }) === null);

// ---- 4. collection (the import / price-refresh batch) ----
const col = db.collection([
  { name: "lightning bolt" },
  { set: "isd", collector_number: "51" },
  { name: "Delver of Secrets" },
  { name: "Lightning Bolt", set: "lea" },
  { id: POOL[8].id },
  { oracle_id: "abc" },
  { name: "No Such Card" },
]);
check("collection resolves names, codes, face names and ids", col.data.map((c) => c.set).join(",") === "m11,isd,isd,lea,m14");
check("collection returns misses (and unsupported identifier kinds) as not_found", col.not_found.length === 2 && col.not_found[0].oracle_id === "abc");

// ---- 5. search: the subset of Scryfall syntax the app builds ----
const names = (r) => (r ? r.data.map((c) => `${c.name}@${c.set}`) : null);
check("plain word search, one row per card", names(db.search("bolt")).join("|") === "Lightning Bolt@m11");
check("words match across the whole name", names(db.search("light")).length === 2);
check("!\"exact\" + unique=prints lists paper printings newest first", names(db.search('!"Lightning Bolt"', { unique: "prints" })).join("|") === "Lightning Bolt@sld|Lightning Bolt@m11|Lightning Bolt@lea");
check("digital-only printings stay out of a paper binder", !names(db.search('!"Lightning Bolt"', { unique: "prints" })).some((s) => s.endsWith("ya25")));
check("tokens are hidden unless asked for", db.search("goblin").total_cards === 0 && db.search("goblin t:token").total_cards === 1);
check("colour filter", names(db.search("c:rw")).join("|") === "Lightning Helix@rav");
check("type + rarity filters", names(db.search("t:creature r:u")).join("|") === "Young Pyromancer@m14");
check("set filter", names(db.search("bolt e:lea")).join("|") === "Lightning Bolt@lea");
check("OR group of sets (the art-card scope)", db.search("(e:lea or e:rav) light", { unique: "prints" }).total_cards === 2);
check("unsupported syntax returns null (client asks Scryfall)", db.search("o:damage") === null && db.search("-bolt") === null && db.search("cmc>=3") === null);
check("parser accepts what AddCardModal builds", !!parseQuery('bolt e:m11 t:"legendary creature" r:mythic c:rg'));

// ---- 6. restart: the saved copy loads without downloading ----
const before = bulkDownloads;
const db2 = createCardDb({ dir, bulkIndexUrl: BULK, log: () => {} });
check("a restart loads the saved copy", db2.loadFromDisk() === true && db2.status().count === POOL.length);
await db2.refresh();
check("an unchanged updated_at doesn't download again", bulkDownloads === before);

// ---- 7. a new day's data swaps in, the old file goes ----
const oldFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".ndjson"));
updatedAt = "2026-09-27T09:00:00+00:00";
const p1 = db2.refresh();
check("overlapping refreshes share one download", p1 === db2.refresh());
await p1;
const newFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".ndjson"));
check("new data swaps in", db2.status().updatedAt === updatedAt && db2.byCode("m11", "149") !== null);
check("the previous file is cleaned up", newFiles.length === 1 && newFiles[0] !== oldFiles[0]);

// ---- 8. a failed refresh keeps serving what it has ----
failIndex = true;
updatedAt = "2026-09-28T09:00:00+00:00";
await db2.refresh(true);
check("still ready after a failed refresh", db2.status().ready === true && db2.byCode("lea", "161") !== null);
check("and says why", !!db2.status().error);
failIndex = false;
db.stop();
db2.stop();

// ---- 9. wired into server.cjs ----
const srvData = path.join(tmp, "srv");
const port = 18000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, ["server.cjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATA_DIR: srvData, CARD_DB_BULK_URL: BULK },
  stdio: "ignore",
});
const base = `http://127.0.0.1:${port}/api/cards`;
let st = null;
for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    st = await (await fetch(`${base}/status`)).json();
    if (st.ready) break;
  } catch (e) {}
}
check("server.cjs downloads on first start and reports ready", st?.ready === true);
const byCodeRes = await fetch(`${base}/code/isd/51`);
check("GET /api/cards/code/:set/:number", byCodeRes.ok && (await byCodeRes.json()).card_faces.length === 2);
check("GET /api/cards/code miss is a 404", (await fetch(`${base}/code/isd/9999`)).status === 404);
const namedRes = await (await fetch(`${base}/named?fuzzy=young%20pyro`)).json();
check("GET /api/cards/named", namedRes.name === "Young Pyromancer");
const searchRes = await (await fetch(`${base}/search?q=${encodeURIComponent('!"Lightning Bolt"')}&unique=prints`)).json();
check("GET /api/cards/search pages like Scryfall", searchRes.total_cards === 3 && searchRes.has_more === false);
check("GET /api/cards/search: unsupported query is a 422", (await fetch(`${base}/search?q=o%3Adamage`)).status === 422);
const colRes = await (
  await fetch(`${base}/collection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifiers: [{ name: "Lightning Helix" }, { name: "Nope" }] }) })
).json();
check("POST /api/cards/collection", colRes.data.length === 1 && colRes.not_found.length === 1);
child.kill();

const off = spawn(process.execPath, ["server.cjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port + 1), DATA_DIR: path.join(tmp, "off"), CARD_DB: "off" },
  stdio: "ignore",
});
let offStatus = 0;
for (let i = 0; i < 25 && !offStatus; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    offStatus = (await fetch(`http://127.0.0.1:${port + 1}/api/cards/status`)).status;
  } catch (e) {}
}
check("CARD_DB=off answers 503 so the client uses Scryfall", offStatus === 503);
off.kill();

fake.close();
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) {}

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
