// Planeswalkers that say "can be your commander" (Jace, Multiverse Architect)
// must count as commanders: in the deck picker, in is:commander search, on
// freshly fetched cards, and on cards saved before the flag existed.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

const JACE_TEXT =
  "At the beginning of combat on each opponent's turn, they may pay {2}. If they don't, creatures they control can't attack Jaces you control this turn.\n+1: Draw two cards, then put a card from your hand on the bottom of your library.\n−3: Exile another target planeswalker or creature you control. Reveal cards from the top of your library until you reveal a creature or planeswalker card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.\nJace, Multiverse Architect can be your commander.";
const rawJace = { object: "card", id: "jace-frc-1", name: "Jace, Multiverse Architect", set: "frc", set_name: "FRC Commander", collector_number: "1", rarity: "mythic", type_line: "Legendary Planeswalker — Jace", oracle_text: JACE_TEXT, mana_cost: "{1}{W}{U}{B}{R}", cmc: 5, color_identity: ["W", "U", "B", "R"], image_uris: { normal: "http://x/j.jpg" }, prices: {} };
const rawNissa = { object: "card", id: "nissa-1", name: "Nissa, Who Shakes the World", set: "war", set_name: "War of the Spark", collector_number: "169", rarity: "rare", type_line: "Legendary Planeswalker — Nissa", oracle_text: "Whenever you tap a Forest for mana, add an additional {G}.", color_identity: ["G"], image_uris: { normal: "http://x/n.jpg" }, prices: {} };

const { rawCanBeCommander, isCommanderCard, needsCommanderCheck } = await import("./src/lib/commander.js");
const { normalizeCard } = await import("./src/lib/scryfall.js");
const { isCommanderCandidate, commanderOptions } = await import("./src/features/decks/commanderPicker.js");
const { parseQuery, matchQuery } = await import("./src/features/collection/query.js");

// ── raw Scryfall data ───────────────────────────────────────────────────
check("Jace (planeswalker, 'can be your commander') → commander", rawCanBeCommander(rawJace));
check("an ordinary legendary planeswalker → not a commander", !rawCanBeCommander(rawNissa));
check("legendary creature → commander", rawCanBeCommander({ type_line: "Legendary Creature — Elf Druid" }));
check("non-legendary creature → not", !rawCanBeCommander({ type_line: "Creature — Elf" }));
check("text on a card face counts", rawCanBeCommander({ type_line: "Legendary Planeswalker — X // Legendary Planeswalker — X", card_faces: [{ type_line: "Legendary Planeswalker — X", oracle_text: "" }, { oracle_text: "X can be your commander." }] }));
check("MDFC with a legendary creature only on the BACK → not", !rawCanBeCommander({ type_line: "Sorcery // Legendary Creature — God", card_faces: [{ type_line: "Sorcery", oracle_text: "Draw." }, { type_line: "Legendary Creature — God", oracle_text: "" }] }));
check("normalizeCard sets canBeCommander true for Jace", normalizeCard(rawJace).canBeCommander === true);
check("normalizeCard sets canBeCommander false for Nissa", normalizeCard(rawNissa).canBeCommander === false);

// ── collection cards ────────────────────────────────────────────────────
const oldJace = { id: "a", name: "Jace, Multiverse Architect", typeLine: "Legendary Planeswalker — Jace", scryfallId: "jace-frc-1" };
check("flagged card is a picker candidate", isCommanderCandidate({ ...oldJace, canBeCommander: true }));
check("sold copy is not", !isCommanderCandidate({ ...oldJace, canBeCommander: true, sold: true }));
check("old legendary creature without a flag still works", isCommanderCandidate({ name: "Atraxa", typeLine: "Legendary Creature — Phyrexian Angel" }));
check("unflagged old Jace needs a rules-text check", needsCommanderCheck(oldJace));
check("…but not once it's been checked", !needsCommanderCheck({ ...oldJace, canBeCommander: false, partner: null }));
check("a legendary creature is looked up once, for a partner ability", needsCommanderCheck({ scryfallId: "z", typeLine: "Legendary Creature — Elf" }));
check("…and not after", !needsCommanderCheck({ scryfallId: "z", typeLine: "Legendary Creature — Elf", partner: null }));
check("non-legendary cards are never looked up", !needsCommanderCheck({ scryfallId: "y", typeLine: "Creature — Elf" }));
check("cached rules text alone confirms it", isCommanderCard(oldJace, JACE_TEXT));
check("picker lists Jace alongside legendary creatures",
  commanderOptions([{ ...oldJace, canBeCommander: true }, { id: "b", name: "Atraxa", typeLine: "Legendary Creature — Angel" }]).map((o) => o.name).join("|") === "Atraxa|Jace, Multiverse Architect");

const q = parseQuery("is:commander");
check("is:commander finds a flagged Jace", matchQuery({ ...oldJace, canBeCommander: true }, q, {}));
check("is:commander finds an unflagged Jace via cached rules text", matchQuery(oldJace, q, { oracleFor: () => ({ t: JACE_TEXT, ty: oldJace.typeLine }) }));
check("is:commander skips Nissa", !matchQuery({ id: "n", name: "Nissa", typeLine: "Legendary Planeswalker — Nissa", canBeCommander: false }, q, {}));

// ── a collection saved before the flag existed ─────────────────────────
const saved = [
  { id: "c1", name: "Jace, Multiverse Architect", set: "frc", collectorNumber: "1", scryfallId: "jace-frc-1", quantity: 1, colors: ["W", "U", "B", "R"], rarity: "mythic", typeLine: "Legendary Planeswalker — Jace", collectionId: "uncategorized", added: 1 },
  { id: "c2", name: "Nissa, Who Shakes the World", set: "war", collectorNumber: "169", scryfallId: "nissa-1", quantity: 1, colors: ["G"], rarity: "rare", typeLine: "Legendary Planeswalker — Nissa", collectionId: "uncategorized", added: 2 },
];
let lastPut = null;
const collectionLookups = [];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    const v = JSON.parse(opts.body).value; lastPut = typeof v === "string" ? JSON.parse(v) : v;
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards: saved }) }) });
  if (u.includes("/cards/collection")) {
    const ids = JSON.parse(opts.body).identifiers.map((x) => x.id);
    collectionLookups.push(ids);
    return Promise.resolve({ ok: true, json: async () => ({ data: [rawJace, rawNissa].filter((r) => ids.includes(r.id)), not_found: [] }) });
  }
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const App = (await import("./src/App.jsx")).default;
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 300)); });

// the lookup waits out Scryfall's rate limit and the save is debounced, so
// give the backfill's save a few seconds to arrive
for (let i = 0; i < 50 && lastPut?.cards?.find((c) => c.id === "c1")?.canBeCommander === undefined; i++) {
  await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
}
const cardsNow = lastPut?.cards || [];
check("backfill looked up only the two legendary non-creatures", collectionLookups.flat().sort().join(",") === "jace-frc-1,nissa-1");
check("saved Jace now carries canBeCommander: true", cardsNow.find((c) => c.id === "c1")?.canBeCommander === true);
check("saved Nissa is recorded as checked (false), so it isn't looked up again", cardsNow.find((c) => c.id === "c2")?.canBeCommander === false);

const decksTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Decks");
await act(async () => { decksTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const optionText = [...document.querySelectorAll("option")].map((o) => o.textContent);
check("Decks → New commander deck offers Jace", optionText.some((t) => t.includes("Jace, Multiverse Architect")));
check("…and not Nissa", !optionText.some((t) => t.includes("Nissa")));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
