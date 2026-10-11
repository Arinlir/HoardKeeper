// Sorting inside a set's roster grid: collector number (natural order,
// lowest printing wins), name, colour/archetype buckets, type, rarity,
// mana value, price (cheapest printing, unpriced last), copies owned —
// plus the Sort control actually reordering the grid and remembering it.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { sortRosterGroups, groupRosterByName, colorBucket, typeBucket, groupCollectorNumber, ROSTER_SORTS } =
  await import("./src/features/sets/rosterUtils.js");

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

// ── pure logic ──────────────────────────────────────────────────────────
const c = (name, cn, extra = {}) => ({ name, set: "tst", collectorNumber: cn, scryfallId: `${name}-${cn}`, rarity: "common", typeLine: "Creature", colors: [], cmc: 0, ...extra });
const roster = [
  c("Zebra", "2", { colors: ["W"], rarity: "rare", cmc: 3, usd: 4 }),
  c("Apple", "10", { colors: ["U", "W"], typeLine: "Instant", cmc: 2, usd: 1 }),
  c("Mango", "10a", { colors: ["G"], typeLine: "Sorcery", rarity: "mythic", cmc: 5 }),
  c("Kiwi", "199", { typeLine: "Land", colors: ["B", "R"], rarity: "uncommon", usd: 0.5 }),
  c("Rock", "150", { typeLine: "Artifact", cmc: 1, usd: 9 }),
  c("Zebra", "300", { colors: ["W"], rarity: "rare", cmc: 3, usd: 2 }), // showcase printing
];
const owned = { "Rock-150": 3, "Zebra-300": 1 };
const groups = groupRosterByName(roster, (p) => owned[p.scryfallId] || 0);
const names = (gs) => gs.map((g) => g.name).join(",");
const price = (p) => p.usd ?? null;

check("ROSTER_SORTS has the eight options", ROSTER_SORTS.length === 8);
check("owned Zebra displays the #300 printing but sits at #2", groups[0].display.collectorNumber === "300" && groupCollectorNumber(groups[0]) === "2");
check("collector # asc is natural: 2,10,10a,150,199", names(sortRosterGroups(groups, "number", "asc")) === "Zebra,Apple,Mango,Rock,Kiwi");
check("collector # desc reverses", names(sortRosterGroups(groups, "number", "desc")) === "Kiwi,Rock,Mango,Apple,Zebra");
check("name asc", names(sortRosterGroups(groups, "name", "asc")) === "Apple,Kiwi,Mango,Rock,Zebra");
check("colour: mono W, mono G, WU pair, colourless, land last", names(sortRosterGroups(groups, "color", "asc")) === "Zebra,Mango,Apple,Rock,Kiwi");
check("pair buckets follow guild order (WU before UB before WB)",
  colorBucket({ colors: ["U", "W"] }) < colorBucket({ colors: ["B", "U"] }) && colorBucket({ colors: ["B", "U"] }) < colorBucket({ colors: ["W", "B"] }));
check("3-colour after pairs, before colourless", colorBucket({ colors: ["W", "U", "B"] }) > colorBucket({ colors: ["U", "G"] }) && colorBucket({ colors: ["W", "U", "B"] }) < colorBucket({ colors: [] }));
check("type: creature, instant, sorcery, artifact, land", names(sortRosterGroups(groups, "type", "asc")) === "Zebra,Apple,Mango,Rock,Kiwi");
check("artifact creature files as a creature", typeBucket({ typeLine: "Artifact Creature — Golem" }) === 0);
check("MDFC is filed by its front face", typeBucket({ typeLine: "Sorcery // Land" }) === typeBucket({ typeLine: "Sorcery" }));
check("rarity desc: mythic, rare, uncommon, then commons in binder order", names(sortRosterGroups(groups, "rarity", "desc")) === "Mango,Zebra,Kiwi,Apple,Rock");
check("mana value asc (ties by collector #)", names(sortRosterGroups(groups, "cmc", "asc")) === "Kiwi,Rock,Apple,Zebra,Mango");
check("price desc uses cheapest printing (Zebra = 2, not 4), unpriced last",
  names(sortRosterGroups(groups, "price", "desc", price)) === "Rock,Zebra,Apple,Kiwi,Mango");
check("price asc still puts unpriced last", names(sortRosterGroups(groups, "price", "asc", price)) === "Kiwi,Apple,Zebra,Rock,Mango");
check("copies owned desc", names(sortRosterGroups(groups, "owned", "desc")).startsWith("Rock,Zebra"));
check("does not mutate the input", names(groups) === "Zebra,Apple,Mango,Kiwi,Rock");

// ── through the UI ──────────────────────────────────────────────────────
const cards = [
  { id: "c1", name: "Capitoline Triad", set: "acr", collectorNumber: "245", scryfallId: "triad-showcase", quantity: 1, usd: 5, colors: [], rarity: "rare", typeLine: "Creature", collectionId: "uncategorized", added: 1 },
];
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/auth/me")) return Promise.resolve({ ok: true, json: async () => ({ user: { id: 1, email: "michael@example.com", verified: true, handle: "michael" } }) });
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "accounts" }) });
  if (u.includes("/api/store"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.includes("api.scryfall.com/sets/"))
    return Promise.resolve({ ok: true, json: async () => ({ name: "Assassin's Creed", code: "acr", card_count: 4, released_at: "2024-01-01" }) });
  if (u.includes("api.scryfall.com/cards/search"))
    return Promise.resolve({
      ok: true,
      json: async () => ({
        data: [
          { object: "card", id: "triad-normal", name: "Capitoline Triad", set: "acr", set_name: "Assassin's Creed", collector_number: "12", rarity: "rare", type_line: "Creature", color_identity: ["W"], image_uris: { normal: "http://x/a.jpg" }, prices: { usd: "5.00" } },
          { object: "card", id: "triad-showcase", name: "Capitoline Triad", set: "acr", set_name: "Assassin's Creed", collector_number: "245", rarity: "rare", type_line: "Creature", color_identity: ["W"], image_uris: { normal: "http://x/b.jpg" }, prices: { usd: "12.00" } },
          { object: "card", id: "murder-1", name: "Murder", set: "acr", set_name: "Assassin's Creed", collector_number: "92", rarity: "uncommon", type_line: "Instant", color_identity: ["B"], image_uris: { normal: "http://x/d.jpg" }, prices: { usd: "6.00" } },
          { object: "card", id: "bell-1", name: "Altair's Bell", set: "acr", set_name: "Assassin's Creed", collector_number: "150", rarity: "common", type_line: "Artifact", color_identity: [], image_uris: { normal: "http://x/e.jpg" }, prices: { usd: "0.10" } },
        ],
        has_more: false,
      }),
    });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

const setsTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Sets");
await act(async () => { setsTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const setRow = [...document.querySelectorAll("div")].find(
  (d) => d.textContent.includes("Assassin's Creed") && (d.getAttribute("style") || "").includes("cursor: pointer")
);
await act(async () => { setRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const TITLES = ["Capitoline Triad", "Murder", "Altair's Bell"];
const gridOrder = () =>
  [...document.querySelectorAll("[title]")].map((d) => d.title).filter((t) => TITLES.includes(t)).filter((t, i, a) => a.indexOf(t) === i).join(",");

const select = document.querySelector('select[aria-label="Sort roster by"]');
check("Sort control is shown on the roster", !!select);
check("default order is collector number (12, 92, 150)", gridOrder() === "Capitoline Triad,Murder,Altair's Bell");

const reactProps = (el) => el[Object.keys(el).find((k) => k.startsWith("__reactProps$"))];
await act(async () => { reactProps(select).onChange({ target: { value: "name" } }); });
check("picking Name reorders the grid A→Z", gridOrder() === "Altair's Bell,Capitoline Triad,Murder");
check("choice is remembered", JSON.parse(localStorage.getItem("lf-roster-sort")).key === "name");

const dirBtn = document.querySelector('button[aria-label^="Roster sorted"]');
await act(async () => { dirBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("direction button reverses it", gridOrder() === "Murder,Capitoline Triad,Altair's Bell");

await act(async () => { reactProps(select).onChange({ target: { value: "color" } }); });
check("Colour / archetype: W, B, then colourless", gridOrder() === "Capitoline Triad,Murder,Altair's Bell");

await act(async () => { reactProps(select).onChange({ target: { value: "price" } }); });
check("Price starts descending, cheapest printing counts (Murder 6 > Triad 5 > Bell 0.10)", gridOrder() === "Murder,Capitoline Triad,Altair's Bell");

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
