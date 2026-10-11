// Two commanders: partner abilities are read from rules text (Partner,
// Partner with, Partner—Character select from the TMNT precon, Friends
// forever, Choose a Background, Doctor's companion), only legal pairs are
// offered, and a deck can take, change, swap and drop its second commander.
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

const { parsePartner, canPair, canHavePartner, combinedIdentity, deckCommanderIds } = await import("./src/lib/commander.js");
const { partnerOptions } = await import("./src/features/decks/commanderPicker.js");
const { parseDecklist, deckToText, deckToJson, jsonToParsed, matchDecklist } = await import("./src/features/decks/deckIO.js");
const { draftDeck } = await import("./src/features/decks/draftLogic.js");
const { deckGameChangers } = await import("./src/lib/brackets.js");

// ── reading the ability ─────────────────────────────────────────────────
check("plain Partner (with reminder text)", parsePartner("Flying\nPartner (You can have two commanders if both have partner.)")?.k === "partner");
check("Partner with <name>", JSON.stringify(parsePartner("Partner with Pir, Imaginative Rascal (When this creature enters…)")) === JSON.stringify({ k: "with", name: "Pir, Imaginative Rascal" }));
check("Partner—Character select (em dash)", JSON.stringify(parsePartner("Partner—Character select\nVigilance")) === JSON.stringify({ k: "variant", v: "character select" }));
check("Partner — Survivors (spaced dash)", parsePartner("Partner — Survivors")?.v === "survivors");
check("Friends forever = its own variant", parsePartner("Friends forever")?.v === "friends forever");
check("Choose a Background", parsePartner("Choose a Background (You can have a Background as a second commander.)")?.k === "choose-bg");
check("Doctor's companion", parsePartner("Doctor’s companion (You can have two commanders if the other is the Doctor.)")?.k === "companion");
check("'partner' inside a sentence doesn't count", parsePartner("Search for a card with partner and put it into your hand.") === null);
check("no ability → null", parsePartner("Draw a card.") === null);

const card = (id, name, typeLine, partner, colors = []) => ({ id, name, typeLine, partner, colors, quantity: 1 });
const leo = card("leo", "Leonardo, Leader in Blue", "Legendary Creature — Mutant Ninja Turtle", { k: "variant", v: "character select" }, ["W", "U"]);
const raph = card("raph", "Raphael, Hothead", "Legendary Creature — Mutant Ninja Turtle", { k: "variant", v: "character select" }, ["R"]);
const heroes = card("heroes", "Heroes in a Half Shell", "Legendary Creature — Mutant Ninja Turtle", null, ["W", "U", "B", "R", "G"]);
const thrasios = card("thr", "Thrasios, Triton Hero", "Legendary Creature — Merfolk Wizard", { k: "partner" }, ["G", "U"]);
const tymna = card("tym", "Tymna the Weaver", "Legendary Creature — Human Cleric", { k: "partner" }, ["W", "B"]);
const pir = card("pir", "Pir, Imaginative Rascal", "Legendary Creature — Human", { k: "with", name: "Toothy, Imaginary Friend" }, ["G"]);
const toothy = card("toothy", "Toothy, Imaginary Friend", "Legendary Creature — Illusion", { k: "with", name: "Pir, Imaginative Rascal" }, ["U"]);
const wilson = card("wil", "Wilson, Refined Grizzly", "Legendary Creature — Bear Warrior", { k: "choose-bg" }, ["G"]);
const bg = card("bg", "Raised by Giants", "Legendary Enchantment — Background", null, ["G"]);
const clara = card("clara", "Clara Oswald", "Legendary Creature — Human", { k: "companion" }, ["U"]);
const doctor = card("doc", "The Eleventh Doctor", "Legendary Creature — Time Lord Doctor", null, ["U", "R"]);
const notDoctor = card("rose", "Rose Tyler", "Legendary Creature — Human", null, ["W"]);

check("Leonardo + Raphael (Character select) pair", canPair(leo, raph));
check("Leonardo can't pair with a plain-Partner card", !canPair(leo, thrasios));
check("Heroes in a Half Shell has no partner — leads alone", !canHavePartner(heroes) && !canPair(heroes, leo));
check("Thrasios + Tymna (Partner)", canPair(thrasios, tymna));
check("Pir + Toothy (Partner with each other)", canPair(pir, toothy) && canPair(toothy, pir));
check("Pir can't pair with Thrasios", !canPair(pir, thrasios));
check("Choose a Background + a Background, either order", canPair(wilson, bg) && canPair(bg, wilson));
check("a Background alone has room for a partner (the chooser)", canHavePartner(bg));
check("Doctor's companion + the Doctor", canPair(clara, doctor) && canPair(doctor, clara));
check("companion + a non-Doctor: no", !canPair(clara, notDoctor));
check("a card can't pair with itself", !canPair(leo, leo));
check("two copies of one legend don't pair", !canPair(thrasios, { ...thrasios, id: "thr2" }));
check("combined identity is WUBRG-ordered union", combinedIdentity([leo, raph]).join("") === "WUR");
check("deckCommanderIds skips a missing partner", deckCommanderIds({ commanderId: "a" }).join() === "a" && deckCommanderIds({ commanderId: "a", partnerId: "b" }).join() === "a,b");
check("partner picker for Leonardo offers only Raphael",
  partnerOptions([leo, raph, heroes, thrasios, tymna, { ...raph, id: "raph-sold", sold: true }], leo).map((o) => o.id).join() === "raph");

// ── decklists ──────────────────────────────────────────────────────────
const list = "Commander\n1 Leonardo, Leader in Blue\n1 Raphael, Hothead\n\nDeck\n1 Sol Ring\n";
const parsed = parseDecklist(list);
check("two lines under Commander → commander + partner", parsed.commander?.name === "Leonardo, Leader in Blue" && parsed.partner?.name === "Raphael, Hothead");
check("…and neither lands in the 99", parsed.entries.length === 1 && parsed.entries[0].name === "Sol Ring");
const tagged = parseDecklist("1 Thrasios, Triton Hero *CMDR*\n1 Tymna the Weaver *CMDR*\n1 Sol Ring");
check("two *CMDR* tags → commander + partner", tagged.commander?.name === "Thrasios, Triton Hero" && tagged.partner?.name === "Tymna the Weaver");
const txt = deckToText({ entries: [], basics: {} }, {}, [leo, raph], [], () => 0);
check("text export lists both under Commander", txt.startsWith("Commander\n1 Leonardo, Leader in Blue\n1 Raphael, Hothead\n\nDeck"));
const js = deckToJson({ name: "Turtles", format: "commander", entries: [], basics: {} }, {}, [leo, raph]);
const back = jsonToParsed(js);
check("JSON export/import round-trips the partner", back.commander?.name === leo.name && back.partner?.name === raph.name);
const oneJs = JSON.parse(deckToJson({ name: "x", entries: [], basics: {} }, {}, leo));
check("single-commander JSON still works, partner null", oneJs.commander?.name === leo.name && oneJs.partner === null);
if (typeof matchDecklist === "function") {
  const m = matchDecklist(parsed, [leo, raph, card("sol", "Sol Ring", "Artifact", null)], {});
  check("matching finds both commanders", m.commanderId === "leo" && m.partnerId === "raph");
}

// ── drafter and bracket see both ───────────────────────────────────────
const pool = [
  { id: "p1", name: "Red Card", typeLine: "Instant", colors: ["R"], scryfallId: "s1", cmc: 1 },
  { id: "p2", name: "Blue Card", typeLine: "Instant", colors: ["U"], scryfallId: "s2", cmc: 1 },
  { id: "p3", name: "Green Card", typeLine: "Instant", colors: ["G"], scryfallId: "s3", cmc: 1 },
  { ...raph, scryfallId: "sr" },
];
const drafted = draftDeck({ ...leo, scryfallId: "sl" }, pool, {}, () => 1, { ...raph, scryfallId: "sr" });
const draftedIds = drafted.entries.map((e) => e.cardId);
check("drafter uses the combined identity (takes the red card)", draftedIds.includes("p1") && draftedIds.includes("p2"));
check("…not outside it", !draftedIds.includes("p3"));
check("…and never drafts the partner into the 99", !draftedIds.includes("raph"));
// a Game Changer standing in as the second commander, so the check has teeth
const gc = deckGameChangers({ commanderId: "leo", partnerId: "gc", entries: [] }, { leo, gc: { ...tymna, id: "gc", name: "Drannith Magistrate" } });
check("bracket reads the second commander too", [...gc].includes("Drannith Magistrate"));

// ── in the app ──────────────────────────────────────────────────────────
const saved = [
  { ...leo, set: "tmc", collectorNumber: "1", scryfallId: "leo-s", canBeCommander: true, collectionId: "uncategorized", added: 1 },
  { ...raph, set: "tmc", collectorNumber: "4", scryfallId: "raph-s", canBeCommander: true, collectionId: "uncategorized", added: 2 },
  { ...heroes, set: "tmc", collectorNumber: "6", scryfallId: "heroes-s", canBeCommander: true, collectionId: "uncategorized", added: 3 },
  { ...thrasios, set: "c16", collectorNumber: "46", scryfallId: "thr-s", canBeCommander: true, collectionId: "uncategorized", added: 4 },
];
const decks = [{ id: "d1", format: "commander", name: "Turtles", commanderId: "leo", entries: [{ cardId: "raph", qty: 1, role: "creature" }], basics: {} }];
let lastPut = null;
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    const v = JSON.parse(opts.body).value;
    lastPut = typeof v === "string" ? JSON.parse(v) : v;
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards: saved, decks }) }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const App = (await import("./src/App.jsx")).default;
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const reactProps = (el) => el[Object.keys(el).find((k) => k.startsWith("__reactProps$"))];
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const savedDeck = async () => {
  for (let i = 0; i < 20; i++) { await wait(100); }
  return lastPut?.decks?.find((d) => d.id === "d1");
};

await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Decks"));
await wait(30);
await click(document.querySelector('[aria-label="Open deck Turtles"]'));
await wait(30);

const second = () => document.querySelector('select[aria-label="Second commander"]');
check("Leonardo's deck shows a Second commander picker", !!second());
check("…offering Raphael only", [...(second()?.options || [])].map((o) => o.value).filter(Boolean).join() === "raph");
check("…with the ability named", document.body.textContent.includes("Partner — Character Select"));

await act(async () => { reactProps(second()).onChange({ target: { value: "raph" } }); });
let d = await savedDeck();
check("choosing Raphael saves partnerId", d?.partnerId === "raph");
check("…and moves him out of the 99", !(d?.entries || []).some((e) => e.cardId === "raph"));
check("header shows both names", document.body.textContent.includes("Leonardo, Leader in Blue & Raphael, Hothead"));

await click(document.querySelector('[aria-label="Swap commanders"]'));
d = await savedDeck();
check("Swap puts Raphael first", d?.commanderId === "raph" && d?.partnerId === "leo");

const primary = () => document.querySelector('select[aria-label="Change commander"]');
await act(async () => { reactProps(primary()).onChange({ target: { value: "heroes" } }); });
d = await savedDeck();
check("changing to Heroes in a Half Shell works", d?.commanderId === "heroes");
check("…and drops the second commander, which can't pair with it", !d?.partnerId);
check("…saying why", document.body.textContent.includes("can't pair with Heroes in a Half Shell"));
check("both old commanders went back into the 99", ["raph", "leo"].every((id) => (d?.entries || []).some((e) => e.cardId === id)));
check("Raphael returned to the category he had before (creature)", d?.entries.find((e) => e.cardId === "raph")?.role === "creature");
check("no Second commander picker for a commander without partner", !second());

await act(async () => { reactProps(primary()).onChange({ target: { value: "leo" } }); });
d = await savedDeck();
check("Leonardo back in charge; Heroes goes into the 99, Leonardo leaves it",
  d?.commanderId === "leo" && d.entries.some((e) => e.cardId === "heroes") && !d.entries.some((e) => e.cardId === "leo"));
const groups = [...primary().querySelectorAll("optgroup")].map((g) => g.label);
check("commander dropdown lists this deck's candidates first", groups[0] === "In this deck");
await act(async () => { reactProps(second()).onChange({ target: { value: "raph" } }); });
await act(async () => { reactProps(second()).onChange({ target: { value: "" } }); });
d = await savedDeck();
check("second commander can be removed again", d?.commanderId === "leo" && !d?.partnerId);
check("…and goes back into the 99", d.entries.some((e) => e.cardId === "raph"));
const total = 1 + (d.partnerId ? 1 : 0) + d.entries.reduce((n, e) => n + (e.qty || 1), 0);
check("rotating never changed the deck's card count (Leo + Raph + Heroes = 3)", total === 3);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
