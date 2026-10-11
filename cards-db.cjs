/*
 * Local card database — a daily copy of Scryfall's "Default Cards" bulk file,
 * so lookups (scanning, Add a card, imports, price refresh) are answered by
 * this server in milliseconds instead of a round trip to api.scryfall.com.
 *
 * Shape on disk (under DATA_DIR/cards):
 *   cards-<stamp>.ndjson  one trimmed Scryfall card object per line
 *   meta.json             which file is current + Scryfall's updated_at
 *
 * In memory: an index of byte offsets plus a small per-printing summary used
 * for search. Full card JSON stays on disk and is read per request, so the
 * resident cost is tens of MB rather than the half-gigabyte bulk file.
 *
 * Card objects keep Scryfall's own field names (just fewer fields), so the
 * client's normalizeCard() reads a local card exactly like one from the API.
 *
 * Everything here is best-effort: if the download fails or hasn't finished
 * yet, the routes answer "not ready" and the client quietly keeps using
 * Scryfall directly, the way it always has.
 *
 * Zero dependencies — Node 18+'s global fetch handles download + gzip.
 */

const fs = require("fs");
const path = require("path");
const { StringDecoder } = require("string_decoder");

const DEFAULT_BULK_INDEX = "https://api.scryfall.com/bulk-data/default-cards";
const USER_AGENT = "Binderwyrm/1.0 (self-hosted MTG collection tracker)";
const PAGE_SIZE = 175; // Scryfall's search page size — the client paginates on it
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000; // re-check daily-ish
const CHECK_EVERY_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------- trimming

const pick = (o, keys) => {
  if (!o) return undefined;
  const out = {};
  keys.forEach((k) => {
    if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  });
  return out;
};
const pickImages = (u) => (u ? pick(u, ["normal", "large", "png"]) : undefined);

// Only what the client reads (normalizeCard, fetchOracleTexts, fetchTokenCards)
// plus what search filters on. Anything else — rulings links, multiverse ids,
// ~10 image sizes — is dropped, which is most of the bulk file's weight.
function trimCard(c) {
  const out = pick(c, [
    "id", "oracle_id", "name", "lang", "released_at", "layout", "set", "set_name",
    "set_type", "collector_number", "digital", "promo", "rarity", "scryfall_uri",
    "finishes", "foil", "frame_effects", "promo_types", "border_color", "full_art",
    "legalities", "cmc", "mana_cost", "type_line", "oracle_text", "colors",
    "color_identity", "power", "toughness", "artist", "games",
  ]);
  if (c.image_uris) out.image_uris = pickImages(c.image_uris);
  if (c.prices) out.prices = pick(c.prices, ["usd", "usd_foil", "usd_etched", "eur", "eur_foil", "eur_etched"]);
  if (Array.isArray(c.card_faces)) {
    out.card_faces = c.card_faces.map((f) => {
      const face = pick(f, ["name", "mana_cost", "type_line", "oracle_text", "colors", "power", "toughness", "artist", "cmc"]);
      if (f.image_uris) face.image_uris = pickImages(f.image_uris);
      return face;
    });
  }
  if (Array.isArray(c.all_parts)) {
    // fetchOracleTexts only ever keeps tokens and combo pieces
    const parts = c.all_parts
      .filter((p) => p.component === "token" || p.component === "combo_piece")
      .map((p) => pick(p, ["id", "name", "type_line", "component"]));
    if (parts.length) out.all_parts = parts;
  }
  return out;
}

// ---------------------------------------------------------------- text helpers

// Lowercase, strip accents and everything that isn't a letter or digit.
// "Lim-Dûl's Vault" → "limdulsvault". Used for fuzzy names and word search.
function squash(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
const lower = (s) => String(s || "").toLowerCase().trim();

function faceNames(card) {
  const names = [card.name];
  if (card.name && card.name.includes("//")) card.name.split("//").forEach((n) => names.push(n.trim()));
  (card.card_faces || []).forEach((f) => f.name && names.push(f.name));
  return [...new Set(names.filter(Boolean))];
}

function levenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Tokens, art-series cards, emblems and memorabilia are hidden from plain
// searches on Scryfall too, unless the query asks for them.
function isExtra(card) {
  return (
    ["token", "double_faced_token", "emblem", "art_series"].includes(card.layout) ||
    ["token", "memorabilia"].includes(card.set_type)
  );
}

// ---------------------------------------------------------------- index

class Index {
  constructor(file) {
    this.file = file;
    // type lines, set codes, dates and rarities repeat thousands of times;
    // keep one copy of each instead of one per printing
    this.pool = new Map();
    this.off = [];
    this.len = [];
    this.meta = []; // per printing: compact summary for search
    this.byId = new Map();
    this.byCode = new Map(); // "set/number" → idx
    this.byName = new Map(); // lowercased name or face name → [idx]
    this.bySquash = new Map(); // squashed full name → oracle name
    this.names = []; // unique oracle names (full "A // B" form)
    this.nameSet = new Set();
  }

  intern(str) {
    const hit = this.pool.get(str);
    if (hit !== undefined) return hit;
    this.pool.set(str, str);
    return str;
  }

  add(card, off, len) {
    const i = this.off.length;
    const I = (v) => this.intern(v);
    this.off.push(off);
    this.len.push(len);
    const colors = new Set(card.colors || []);
    (card.card_faces || []).forEach((f) => (f.colors || []).forEach((c) => colors.add(c)));
    this.meta.push({
      n: I(card.name),
      sq: I(squash(card.name)),
      s: I(lower(card.set)),
      r: I(lower(card.rarity)),
      t: I(lower(card.type_line || (card.card_faces || []).map((f) => f.type_line).join(" // "))),
      c: I([...colors].sort().join("")),
      rel: I(card.released_at || ""),
      cn: card.collector_number || "",
      x: isExtra(card),
      dg: !!card.digital || (Array.isArray(card.games) && card.games.length > 0 && !card.games.includes("paper")),
      // lower = better default printing: paper, non-promo, not an oddity
      rank: (card.digital ? 4 : 0) + (card.promo ? 2 : 0) + (isExtra(card) ? 8 : 0) +
        (["funny", "memorabilia", "promo"].includes(card.set_type) ? 1 : 0),
    });
    if (card.id) this.byId.set(card.id, i);
    if (card.set && card.collector_number) this.byCode.set(`${lower(card.set)}/${lower(card.collector_number)}`, i);
    faceNames(card).forEach((n) => {
      const k = lower(n);
      const arr = this.byName.get(k);
      if (arr) arr.push(i);
      else this.byName.set(k, [i]);
    });
    if (!this.nameSet.has(card.name)) {
      this.nameSet.add(card.name);
      this.names.push(card.name);
      this.bySquash.set(squash(card.name), card.name);
      faceNames(card).forEach((n) => {
        const sq = squash(n);
        if (!this.bySquash.has(sq)) this.bySquash.set(sq, card.name);
      });
    }
  }

  get count() {
    return this.off.length;
  }

  // Best printing first: rank, then newest.
  compare(a, b) {
    const ma = this.meta[a];
    const mb = this.meta[b];
    return ma.rank - mb.rank || mb.rel.localeCompare(ma.rel);
  }
}

// Splits a stream of JSON text (an array of objects, however it's formatted)
// into one string per top-level object, without holding the whole thing.
class ObjectSplitter {
  constructor(onObject) {
    this.onObject = onObject;
    this.buf = "";
    this.depth = 0;
    this.inStr = false;
    this.esc = false;
    this.start = -1;
  }
  feed(chunk) {
    const s = this.buf + chunk;
    // resume where the last chunk stopped; this.start is relative to s
    for (let i = this.buf.length; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (ch === 92) this.esc = true; // backslash
        else if (ch === 34) this.inStr = false; // quote
        continue;
      }
      if (ch === 34) this.inStr = true;
      else if (ch === 123) {
        if (this.depth === 0) this.start = i;
        this.depth++;
      } else if (ch === 125) {
        this.depth--;
        if (this.depth === 0 && this.start >= 0) {
          this.onObject(s.slice(this.start, i + 1));
          this.start = -1;
        }
      }
    }
    // keep only the unfinished object (or nothing)
    if (this.depth > 0 && this.start >= 0) {
      this.buf = s.slice(this.start);
      this.start = 0;
    } else {
      this.buf = "";
      this.start = -1;
    }
  }
}

// ---------------------------------------------------------------- search query

// A deliberately small subset of Scryfall's syntax — exactly what the app
// itself builds: bare words, !"exact name", e:/set:, t:/type:, r:/rarity:,
// c:/color:, game:paper, and a parenthesised OR group of those (the art-card
// scope). Anything else returns null and the client asks Scryfall instead,
// so an unsupported query is never answered wrongly — just not locally.
const RARITY = { c: "common", u: "uncommon", r: "rare", m: "mythic", s: "special", b: "bonus" };

function tokenize(q) {
  const out = [];
  const re = /\s*(\(|\)|!"[^"]*"|[a-z]+:"[^"]*"|[a-z]+:[^\s()]+|"[^"]*"|[^\s()]+)/giy;
  let m;
  let last = 0;
  while ((m = re.exec(q))) {
    out.push(m[1]);
    last = re.lastIndex;
  }
  if (q.slice(last).trim()) return null;
  return out;
}

function parseTerm(tok) {
  if (tok.startsWith('!"')) return { k: "exact", v: lower(tok.slice(2, -1)) };
  const kv = tok.match(/^([a-z]+):(.*)$/i);
  if (kv) {
    const key = kv[1].toLowerCase();
    let val = kv[2];
    if (val.startsWith('"')) val = val.slice(1, -1);
    val = lower(val);
    if (!val) return null;
    if (["e", "s", "set", "edition"].includes(key)) return /^[a-z0-9]+$/.test(val) ? { k: "set", v: val } : null;
    if (["t", "type"].includes(key)) return { k: "type", v: val };
    if (["r", "rarity"].includes(key)) {
      const r = RARITY[val] || (Object.values(RARITY).includes(val) ? val : null);
      return r ? { k: "rarity", v: r } : null;
    }
    if (["c", "color", "colour"].includes(key)) {
      const names = { white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c" };
      const v = names[val] || val;
      return /^[wubrgc]+$/.test(v) ? { k: "color", v: v.toUpperCase() } : null;
    }
    if (key === "game" && val === "paper") return { k: "paper" };
    return null; // unknown keyword → let Scryfall handle it
  }
  if (tok.startsWith('"')) {
    const sq = squash(tok.slice(1, -1));
    return sq ? { k: "word", v: sq } : null;
  }
  // negation, comparisons (cmc>=3, pow=2), boolean words: Scryfall's job
  if (/^[-!]/.test(tok) || /[<>=]/.test(tok) || /^(or|and)$/i.test(tok)) return null;
  const sq = squash(tok);
  return sq ? { k: "word", v: sq } : { k: "noop" };
}

function parseQuery(q) {
  const toks = tokenize(String(q || "").trim());
  if (!toks || toks.length === 0) return null;
  const terms = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === "(") {
      const group = [];
      let j = i + 1;
      let expectTerm = true;
      for (; j < toks.length && toks[j] !== ")"; j++) {
        if (expectTerm) {
          const term = parseTerm(toks[j]);
          if (!term || term.k === "noop" || term.k === "word") return null;
          group.push(term);
        } else if (!/^or$/i.test(toks[j])) return null;
        expectTerm = !expectTerm;
      }
      if (j >= toks.length || expectTerm || group.length === 0) return null;
      terms.push({ k: "or", v: group });
      i = j;
      continue;
    }
    if (t === ")") return null;
    const term = parseTerm(t);
    if (!term) return null;
    if (term.k !== "noop") terms.push(term);
  }
  return terms.length ? terms : null;
}

function termMatches(term, m) {
  switch (term.k) {
    case "word": return m.sq.includes(term.v);
    case "exact": return false; // handled by candidate selection
    case "set": return m.s === term.v;
    case "type": return m.t.includes(term.v);
    case "rarity": return m.r === term.v;
    case "color":
      if (term.v === "C") return m.c === "";
      return [...term.v].every((ch) => ch === "C" || m.c.includes(ch));
    case "paper": return !m.dg;
    case "or": return term.v.some((t) => termMatches(t, m));
    default: return false;
  }
}

// ---------------------------------------------------------------- the db

function createCardDb(opts = {}) {
  const dir = opts.dir;
  const bulkIndexUrl = opts.bulkIndexUrl || DEFAULT_BULK_INDEX;
  const log = opts.log || ((...a) => console.log("[cards]", ...a));
  const metaPath = path.join(dir, "meta.json");

  let index = null; // current, fully built
  let fd = null;
  let meta = null;
  let refreshing = null;
  let lastError = null;
  let lastAttempt = 0;

  fs.mkdirSync(dir, { recursive: true });

  function readCard(i) {
    const buf = Buffer.alloc(index.len[i]);
    fs.readSync(fd, buf, 0, buf.length, index.off[i]);
    return JSON.parse(buf.toString("utf8"));
  }

  function swapIn(newIndex, newMeta) {
    const oldFd = fd;
    const oldFile = index && index.file;
    fd = fs.openSync(newIndex.file, "r");
    newIndex.pool = null; // only needed while building
    index = newIndex;
    meta = newMeta;
    if (oldFd !== null) {
      try { fs.closeSync(oldFd); } catch (e) {}
    }
    if (oldFile && oldFile !== newIndex.file) {
      try { fs.unlinkSync(oldFile); } catch (e) {}
    }
  }

  // Build an index from an existing ndjson file (server start).
  function loadFromDisk() {
    let m;
    try {
      m = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch (e) {
      return false;
    }
    const file = path.join(dir, m.file || "");
    if (!m.file || !fs.existsSync(file)) return false;
    const idx = new Index(file);
    const rfd = fs.openSync(file, "r");
    try {
      const chunk = Buffer.alloc(4 * 1024 * 1024);
      let pos = 0;
      let carry = Buffer.alloc(0);
      let carryStart = 0;
      for (;;) {
        const n = fs.readSync(rfd, chunk, 0, chunk.length, pos);
        if (n === 0) break;
        const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n);
        let lineStart = 0;
        for (let i = 0; i < data.length; i++) {
          if (data[i] === 10) {
            if (i > lineStart) {
              const card = JSON.parse(data.toString("utf8", lineStart, i));
              idx.add(card, carryStart + lineStart, i - lineStart);
            }
            lineStart = i + 1;
          }
        }
        carry = Buffer.from(data.subarray(lineStart));
        carryStart = carryStart + lineStart;
        pos += n;
      }
    } finally {
      fs.closeSync(rfd);
    }
    swapIn(idx, m);
    // stray files from an interrupted download
    fs.readdirSync(dir)
      .filter((f) => /^cards-.*\.ndjson(\.part)?$/.test(f) && f !== m.file)
      .forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });
    log(`loaded ${idx.count} printings (Scryfall data from ${m.updatedAt || "unknown"})`);
    return true;
  }

  async function download(force = false) {
    lastAttempt = Date.now();
    const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
    const res = await fetch(bulkIndexUrl, { headers });
    if (!res.ok) throw new Error(`bulk index answered ${res.status}`);
    const info = await res.json();
    if (!info.download_uri) throw new Error("bulk index has no download_uri");
    if (!force && meta && index && meta.updatedAt === info.updated_at) {
      meta = { ...meta, checkedAt: Date.now() };
      fs.writeFileSync(metaPath, JSON.stringify(meta));
      return false;
    }
    log(`downloading ${info.download_uri}`);
    const bulk = await fetch(info.download_uri, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } });
    if (!bulk.ok || !bulk.body) throw new Error(`bulk download answered ${bulk.status}`);

    const stamp = Date.now();
    const name = `cards-${stamp}.ndjson`;
    const file = path.join(dir, name);
    const part = file + ".part";
    const out = fs.openSync(part, "w");
    const idx = new Index(file);
    let off = 0;
    let pending = [];
    let pendingBytes = 0;
    const flush = () => {
      if (!pending.length) return;
      fs.writeSync(out, Buffer.concat(pending));
      pending = [];
      pendingBytes = 0;
    };
    const splitter = new ObjectSplitter((txt) => {
      const card = trimCard(JSON.parse(txt));
      if (!card.id || !card.name) return;
      const line = Buffer.from(JSON.stringify(card) + "\n", "utf8");
      idx.add(card, off, line.length - 1);
      off += line.length;
      pending.push(line);
      pendingBytes += line.length;
      if (pendingBytes > 1024 * 1024) flush();
    });
    const decoder = new StringDecoder("utf8");
    try {
      for await (const chunk of bulk.body) splitter.feed(decoder.write(Buffer.from(chunk)));
      splitter.feed(decoder.end());
      flush();
    } finally {
      fs.closeSync(out);
    }
    if (idx.count < 1) {
      try { fs.unlinkSync(part); } catch (e) {}
      throw new Error("bulk file held no cards");
    }
    fs.renameSync(part, file);
    const newMeta = { file: name, updatedAt: info.updated_at || null, downloadedAt: stamp, checkedAt: stamp, count: idx.count };
    fs.writeFileSync(metaPath + ".tmp", JSON.stringify(newMeta));
    fs.renameSync(metaPath + ".tmp", metaPath);
    swapIn(idx, newMeta);
    log(`ready: ${idx.count} printings`);
    return true;
  }

  function refresh(force = false) {
    if (refreshing) return refreshing;
    refreshing = download(force)
      .then((changed) => {
        lastError = null;
        return changed;
      })
      .catch((e) => {
        lastError = e.message;
        log(`refresh failed: ${e.message} — will retry later; lookups fall back to Scryfall meanwhile`);
        return false;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  function isStale() {
    if (!index) return true;
    const checked = (meta && (meta.checkedAt || meta.downloadedAt)) || 0;
    return Date.now() - checked > REFRESH_AFTER_MS;
  }

  let timer = null;
  function start() {
    try {
      loadFromDisk();
    } catch (e) {
      log(`couldn't load the saved card data (${e.message}) — downloading afresh`);
    }
    if (isStale()) refresh();
    timer = setInterval(() => {
      // failed attempts wait a full interval before retrying, never hammer
      if (isStale() && Date.now() - lastAttempt >= CHECK_EVERY_MS - 1000) refresh();
    }, CHECK_EVERY_MS);
    if (timer.unref) timer.unref();
    return api;
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (e) {}
      fd = null;
    }
  }

  // ------------------------------------------------------------ queries

  function bestOf(idxs, filter) {
    let best = -1;
    for (const i of idxs) {
      if (filter && !filter(i)) continue;
      if (best < 0 || index.compare(i, best) < 0) best = i;
    }
    return best;
  }

  function byCode(set, number) {
    if (!index) return null;
    const s = lower(set);
    const n = lower(number);
    let i = index.byCode.get(`${s}/${n}`);
    if (i === undefined && /^0+\d/.test(n)) i = index.byCode.get(`${s}/${n.replace(/^0+/, "")}`);
    return i === undefined ? null : readCard(i);
  }

  function byId(id) {
    if (!index) return null;
    const i = index.byId.get(lower(id));
    return i === undefined ? null : readCard(i);
  }

  function exactIdxs(name) {
    return index.byName.get(lower(name)) || [];
  }

  // Resolve a (possibly misspelled) name to one oracle name, or null when
  // it's ambiguous — ambiguity goes to Scryfall rather than being guessed.
  function resolveFuzzy(name) {
    const sq = squash(name);
    if (!sq) return null;
    const hit = index.bySquash.get(sq);
    if (hit) return hit;
    const prefix = [];
    for (const [k, v] of index.bySquash) {
      if (k.startsWith(sq)) {
        if (!prefix.includes(v)) prefix.push(v);
        if (prefix.length > 1) break;
      }
    }
    if (prefix.length === 1) return prefix[0];
    if (prefix.length > 1) return null;
    if (sq.length < 5) return null;
    const max = sq.length < 8 ? 1 : 2;
    let best = null;
    let bestD = max + 1;
    let tie = false;
    for (const [k, v] of index.bySquash) {
      const d = levenshtein(sq, k, max);
      if (d < bestD) {
        bestD = d;
        best = v;
        tie = false;
      } else if (d === bestD && v !== best) tie = true;
    }
    return bestD <= max && !tie ? best : null;
  }

  function named({ exact, fuzzy, set }) {
    if (!index) return null;
    const s = set ? lower(set) : null;
    const inSet = s ? (i) => index.meta[i].s === s : null;
    let idxs = [];
    if (exact) idxs = exactIdxs(exact);
    else if (fuzzy) {
      idxs = exactIdxs(fuzzy);
      if (!idxs.length) {
        const n = resolveFuzzy(fuzzy);
        if (n) idxs = exactIdxs(n);
      }
    }
    const i = bestOf(idxs, inSet);
    return i < 0 ? null : readCard(i);
  }

  function collection(identifiers) {
    if (!index) return null;
    const data = [];
    const notFound = [];
    (identifiers || []).forEach((ident) => {
      let i = -1;
      if (ident && ident.id) {
        const hit = index.byId.get(lower(ident.id));
        if (hit !== undefined) i = hit;
      } else if (ident && ident.set && ident.collector_number) {
        const s = lower(ident.set);
        const n = lower(ident.collector_number);
        let hit = index.byCode.get(`${s}/${n}`);
        if (hit === undefined && /^0+\d/.test(n)) hit = index.byCode.get(`${s}/${n.replace(/^0+/, "")}`);
        if (hit !== undefined) i = hit;
      } else if (ident && ident.name) {
        const s = ident.set ? lower(ident.set) : null;
        i = bestOf(exactIdxs(ident.name), s ? (x) => index.meta[x].s === s : null);
      }
      // other identifier kinds (oracle_id, multiverse_id…) go to not_found,
      // and the client sends those on to Scryfall
      if (i >= 0) data.push(readCard(i));
      else notFound.push(ident);
    });
    return { object: "list", not_found: notFound, data };
  }

  // Returns null when the query uses syntax we don't evaluate.
  function search(q, { unique = "cards", page = 1 } = {}) {
    if (!index) return null;
    const terms = parseQuery(q);
    if (!terms) return null;
    const exact = terms.find((t) => t.k === "exact");
    const wantsExtras = terms.some(
      (t) =>
        t.k === "set" ||
        (t.k === "or" && t.v.some((x) => x.k === "set")) ||
        (t.k === "type" && /token|emblem|art|dungeon|card/.test(t.v))
    );
    const rest = terms.filter((t) => t.k !== "exact");
    const ok = (i) => {
      const m = index.meta[i];
      if (!wantsExtras && m.x) return false;
      if (m.dg && !terms.some((t) => t.k === "paper")) {
        // digital-only printings (Alchemy etc.) don't belong in a paper binder
        return false;
      }
      return rest.every((t) => termMatches(t, m));
    };
    let hits = [];
    if (exact) {
      hits = exactIdxs(exact.v).filter(ok);
    } else {
      for (let i = 0; i < index.count; i++) if (ok(i)) hits.push(i);
    }
    let list;
    if (unique === "prints") {
      list = hits.sort((a, b) => {
        const ma = index.meta[a];
        const mb = index.meta[b];
        return mb.rel.localeCompare(ma.rel) || ma.s.localeCompare(mb.s) || ma.cn.localeCompare(mb.cn, undefined, { numeric: true });
      });
    } else {
      const best = new Map();
      hits.forEach((i) => {
        const n = index.meta[i].n;
        const cur = best.get(n);
        if (cur === undefined || index.compare(i, cur) < 0) best.set(n, i);
      });
      list = [...best.values()].sort((a, b) => index.meta[a].n.localeCompare(index.meta[b].n));
    }
    const p = Math.max(1, parseInt(page, 10) || 1);
    const slice = list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    return {
      object: "list",
      total_cards: list.length,
      has_more: p * PAGE_SIZE < list.length,
      data: slice.map(readCard),
    };
  }

  function status() {
    return {
      ready: !!index,
      count: index ? index.count : 0,
      updatedAt: meta ? meta.updatedAt : null,
      downloading: !!refreshing,
      error: lastError,
    };
  }

  const api = { start, stop, refresh, loadFromDisk, status, byCode, byId, named, collection, search };
  return api;
}

// ---------------------------------------------------------------- http routes

// Mounted by server.cjs under /api/cards/. Returns true when it handled the
// request. Not-ready and not-found both answer so the client can fall back.
async function handleCardsApi(db, req, res, url, { json, readBody }) {
  const p = url.pathname;
  if (!p.startsWith("/api/cards/")) return false;
  const st = db.status();
  const notReady = () => json(res, 503, { error: "Card database not ready", ...st });

  if (p === "/api/cards/status") return json(res, 200, st), true;
  if (!st.ready) return notReady(), true;

  // Cards change once a day; let the browser keep an answer for an hour.
  const card = (c) => {
    if (!c) return json(res, 404, { object: "error", code: "not_found" });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=3600" });
    res.end(JSON.stringify(c));
  };

  let m;
  if ((m = p.match(/^\/api\/cards\/code\/([^/]+)\/([^/]+)$/)) && req.method === "GET") {
    return card(db.byCode(decodeURIComponent(m[1]), decodeURIComponent(m[2]))), true;
  }
  if ((m = p.match(/^\/api\/cards\/id\/([0-9a-f-]{36})$/i)) && req.method === "GET") {
    return card(db.byId(m[1])), true;
  }
  if (p === "/api/cards/named" && req.method === "GET") {
    const q = url.searchParams;
    return card(db.named({ exact: q.get("exact"), fuzzy: q.get("fuzzy"), set: q.get("set") })), true;
  }
  if (p === "/api/cards/search" && req.method === "GET") {
    const q = url.searchParams;
    const r = db.search(q.get("q") || "", { unique: q.get("unique") || "cards", page: q.get("page") || 1 });
    if (!r) return json(res, 422, { error: "Query not supported locally" }), true;
    return json(res, 200, r), true;
  }
  if (p === "/api/cards/collection" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return json(res, 400, { error: "Bad JSON" }), true;
    }
    const ids = Array.isArray(body.identifiers) ? body.identifiers.slice(0, 1000) : [];
    return json(res, 200, db.collection(ids)), true;
  }
  return json(res, 404, { error: "Not found" }), true;
}

module.exports = { createCardDb, handleCardsApi, trimCard, parseQuery, squash, ObjectSplitter };
