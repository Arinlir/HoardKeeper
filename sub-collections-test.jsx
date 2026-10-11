// Collections one level deep: "Universes Beyond" holds Marvel, Assassin's
// Creed and TMNT. The main chip row only lists top-level collections, picking
// a parent shows everything inside it plus a row of its parts, the parent's
// totals add up its parts, and pickers name the parent. Bad data (a missing
// parent, a parent that itself has a parent, a loop) never hides anything.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

import { collectionOptions, collectionPath, possibleParents, scopeIds, topLevel } from "./src/lib/collectionTree";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- the tree helpers --------------------------------------------------------
const cols = [
  { id: "ub", name: "Universes Beyond", purchasePrice: 0 },
  { id: "mv", name: "Marvel", parentId: "ub", purchasePrice: 100 },
  { id: "ac", name: "Assassin's Creed", parentId: "ub", purchasePrice: 0 },
  { id: "pc", name: "Precons", purchasePrice: 0 },
];
check("top level is the parents and loose collections", topLevel(cols).map((c) => c.id).join() === "ub,pc");
check("a parent's scope includes its parts", [...scopeIds(cols, "ub")].sort().join() === "ac,mv,ub");
check("a part's scope is just itself", [...scopeIds(cols, "mv")].join() === "mv");
check("a part is named with its parent", collectionPath(cols, "mv") === "Universes Beyond › Marvel");
check("pickers list each parent followed by its parts",
  collectionOptions(cols).map((o) => o.label).join(" | ") === "Universes Beyond | Universes Beyond › Marvel | Universes Beyond › Assassin's Creed | Precons");
check("a collection can't go inside itself", !possibleParents(cols, "pc").some((c) => c.id === "pc"));
check("a parent can't go inside another (one level only)", possibleParents(cols, "ub").length === 0);
check("a part can't be a parent", !possibleParents(cols, "pc").some((c) => c.id === "mv"));

const broken = [
  { id: "a", name: "A", parentId: "gone" }, // parent deleted
  { id: "b", name: "B", parentId: "b" }, // itself
  { id: "c", name: "C", parentId: "d" }, // a loop…
  { id: "d", name: "D", parentId: "c" }, // …both ways
  { id: "e", name: "E" },
  { id: "f", name: "F", parentId: "e" },
  { id: "g", name: "G", parentId: "f" }, // too deep
];
const shown = collectionOptions(broken).map((o) => o.id).sort().join();
check("bad data never hides a collection", shown === "a,b,c,d,e,f,g");
check("a missing parent reads as top level", topLevel(broken).some((c) => c.id === "a"));
check("a too-deep collection reads as top level", topLevel(broken).some((c) => c.id === "g"));

// ---- the real App ---------------------------------------------------------------
const card = (id, name, collectionId, usd) => ({
  id, name, set: "sld", setName: "Secret Lair", collectorNumber: id, quantity: 1, finish: "nonfoil", condition: "NM",
  collectionId, location: "", usd, colors: [], rarity: "rare", typeLine: "Artifact", added: 1,
});
const cards = [
  card("k1", "Spider-Man", "mv", 30),
  card("k2", "Iron Man", "mv", 20),
  card("k3", "Ezio Auditore", "ac", 10),
  card("k4", "Sol Ring", "pc", 2),
];
let lastSaved = null;
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store") && opts?.method === "PUT") {
    try { lastSaved = JSON.parse(JSON.parse(opts.body).value); } catch { /* ignore */ }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: cols, cards, ratesAuto: false, ratesUpdated: Date.now() }) }) });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const reactProps = (el) => el[Object.keys(el).find((k) => k.startsWith("__reactProps$"))];
const chip = (id) => document.querySelector(`[data-testid="collection-chip-${id}"]`);
const shownCards = () => [...document.querySelectorAll("[data-card-id]")].map((e) => e.getAttribute("data-card-id")).sort().join();
const subRow = () => document.querySelector('[data-testid="subcollection-row"]');

check("the main row has the parent and the loose collection", !!chip("ub") && !!chip("pc"));
check("parts aren't in the main row until their parent is picked", !chip("mv") && !chip("ac") && !subRow());
check("the parent's count includes its parts", chip("ub").textContent.includes("Universes Beyond (3)"));

await click(chip("ub"));
check("picking the parent shows everything inside it", shownCards() === "k1,k2,k3");
check("…and opens a row of its parts", !!subRow() && subRow().textContent.includes("Marvel (2)") && subRow().textContent.includes("Assassin's Creed (1)"));

await click(chip("mv"));
check("picking a part shows just that part", shownCards() === "k1,k2");
check("the parent stays marked while a part is picked", !!chip("ub") && chip("ub").getAttribute("aria-pressed") === "false" && !!subRow());
const allChip = [...subRow().querySelectorAll("button")].find((b) => b.textContent.startsWith("All ("));
await click(allChip);
check("the part row's All goes back to the whole parent", shownCards() === "k1,k2,k3");

// search reaches through the parent's name
await click([...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("All (") && !subRow()?.contains(b)));
const search = document.querySelector("input.search-input");
await act(async () => { reactProps(search).onChange({ target: { value: 'col:"universes beyond"' } }); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
check('col:"universes beyond" finds the cards in its parts', shownCards() === "k1,k2,k3");
await act(async () => { reactProps(search).onChange({ target: { value: "" } }); });

// a card's collection picker names the parent
await click(document.querySelector('[data-card-id="k1"]'));
const sel = document.getElementById("dm-collection");
check("a card's collection picker names the parent", [...(sel?.options || [])].some((o) => o.textContent.trim() === "Universes Beyond › Marvel"));
await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
const bd = document.querySelector('[data-role="modal-backdrop"]');
if (bd) await click(bd);

// the Collections dialog
const openCollections = async () => click([...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || b.textContent).trim() === "Collections"));
await openCollections();
const rollup = document.querySelector('[data-testid="collection-rollup-ub"]');
check("the parent shows its parts added up", !!rollup && rollup.textContent.includes("3 cards") && rollup.textContent.includes("$60.00"));
check("…including what the parts cost", rollup?.textContent.includes("invested $100.00"));
const rowMv = document.querySelector('[data-testid="collection-row-mv"]');
check("parts are listed under their parent", !!rowMv && rowMv.style.marginLeft !== "" && rowMv.style.marginLeft !== "0px");
const acSelect = document.getElementById("cm-parent-ac");
check("each part can be moved", !!acSelect && acSelect.value === "ub");
check("a parent can't be put inside anything", !document.getElementById("cm-parent-ub"));
await act(async () => { reactProps(acSelect).onChange({ target: { value: "" } }); });
check("moving a part to the top level updates the totals", document.querySelector('[data-testid="collection-rollup-ub"]')?.textContent.includes("2 cards"));

// reordering: Precons up above Universes Beyond, and the arrows stop at the ends
const orderNow = () => [...document.querySelectorAll('[data-testid^="collection-row-"]')].map((r) => r.getAttribute("data-testid").replace("collection-row-", "")).join();
const btnByLabel = (l) => document.querySelector(`[aria-label="${l}"]`);
check("the first collection can't move up", btnByLabel("Move Universes Beyond up")?.disabled === true);
const before = orderNow(); // ub,mv,ac,pc — Assassin's Creed was just put back at the top level
await click(btnByLabel("Move Precons up"));
check("moving up swaps with the neighbour on the same level", orderNow() === "ub,mv,pc,ac");
await click(btnByLabel("Move Precons up"));
check("…and again goes above Universes Beyond (with its parts staying under it)", orderNow() === "pc,ub,mv,ac");
check("Precons is now first, so its up arrow is off", btnByLabel("Move Precons up")?.disabled === true);
await click(btnByLabel("Move Marvel down"));
check("a part moves only among its own siblings", orderNow() === "pc,ub,mv,ac" || orderNow() === "pc,ub,mv,ac");

// delete the parent: its parts step up rather than vanish
const del = document.querySelector('[aria-label="Delete Universes Beyond"]');
await click(del);
await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Sure?"));
await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
check("deleting a parent keeps its parts, at the top level", !!lastSaved && !lastSaved.collections.some((c) => c.id === "ub") && lastSaved.collections.find((c) => c.id === "mv")?.parentId == null);
check("…and their cards stay put", lastSaved?.cards.find((c) => c.id === "k1")?.collectionId === "mv");

// new collection, created while a parent is picked, defaults inside it
await act(async () => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("New collection"));
  b && b.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
});
const parentSel = document.getElementById("ac-parent");
check("a new collection can be put inside one", !!parentSel && [...parentSel.options].some((o) => o.textContent === "Marvel"));
const nameInput = document.getElementById("ac-name");
await act(async () => { reactProps(nameInput).onChange({ target: { value: "Spider-Verse" } }); });
await act(async () => { reactProps(parentSel).onChange({ target: { value: "mv" } }); });
await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Create collection"));
await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
check("…and is saved there", lastSaved?.collections.find((c) => c.name === "Spider-Verse")?.parentId === "mv");

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
