// Commanders are typed in, not picked from the collection. A seat whose name
// hasn't been filled in takes the commander's name; a seat somebody named keeps
// its name and shows the commander beside it. The result of a finished game
// carries the commander. Partners are a switch on the seat, and a partnered seat
// offers its two commanders as A and B.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const CARDS = [
  { name: "Atraxa, Praetors' Voice", type_line: "Legendary Creature — Phyrexian Angel Horror", oracle_text: "Flying" },
  { name: "Korvold, Fae-Cursed King", type_line: "Legendary Creature — Dragon Noble", oracle_text: "Flying" },
  { name: "Kordrazz the Test", type_line: "Legendary Creature — Test", oracle_text: "" },
  { name: "Esika, God of the Tree // The Prismatic Bridge", type_line: "Legendary Creature — God // Legendary Artifact", oracle_text: "Vigilance" },
  { name: "Grist, the Hunger Tide", type_line: "Legendary Planeswalker — Grist", oracle_text: "Grist can be your commander." },
  { name: "Sol Ring", type_line: "Artifact", oracle_text: "{T}: Add {C}{C}." },
];
const posted = [];
let serverDown = false;
const SERVER_GAMES = [
  { id: "s1", at: 30, format: "commander", winnerName: "Zed", seats: [{ name: "Zed", commander: "Ghave", won: true }, { name: "Ann", commander: "Meren", won: false }] },
  { id: "s2", at: 20, format: "commander", winnerName: "Ann", seats: [{ name: "Zed", commander: "Ghave", won: false }, { name: "Ann", commander: "Meren", won: true }] },
  { id: "s3", at: 10, format: "commander", winnerName: "Zed", seats: [{ name: "Zed", commander: "Ghave", won: true }, { name: "Ann", commander: "Meren", won: false }] },
];
globalThis.fetch = (url, opts = {}) => {
  const u = String(url);
  if (u.includes("/api/life/games")) {
    if (serverDown) return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
    if (opts.method === "POST") {
      posted.push(...JSON.parse(opts.body).games);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ games: SERVER_GAMES }) });
  }
  if (u.includes("/api/cards/status")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ready: true }) });
  if (u.includes("/api/cards/search")) {
    const raw = decodeURIComponent(u.split("q=")[1].split("&")[0]);
    const exact = raw.match(/^!"(.*)"$/);
    const q = raw.replace(/^t:legendary\s*/, "").toLowerCase();
    const pool = CARDS.filter((c) => (exact ? c.name.toLowerCase() === exact[1].toLowerCase() || c.name.toLowerCase().startsWith(exact[1].toLowerCase() + " //") : /^t:legendary/.test(raw) ? /Legendary/.test(c.type_line) && c.name.toLowerCase().includes(q) : c.name.toLowerCase().includes(q)));
    const data = pool.map((c) => ({ id: c.name, set: "tst", collector_number: "1", image_uris: {}, prices: {}, ...c }));
    return Promise.resolve(data.length ? { ok: true, status: 200, json: async () => ({ data }) } : { ok: false, status: 404, json: async () => ({}) });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- the rules ----
const S = await import("./src/features/life/lifeState.js");
const seat = (name, commander) => ({ ...S.makeLifePlayer(3, name, 40), commander });
check("an unnamed seat takes the commander's name", S.withCommander(seat("Player 3"), 2, "Atraxa, Praetors' Voice").name === "Atraxa, Praetors' Voice");
check("a blank name does too", S.withCommander(seat("  "), 2, "Korvold").name === "Korvold");
check("it keeps following while the commander is being typed or changed", (() => {
  let p = seat("Player 3");
  for (const t of ["K", "Kor", "Korvold", "Meren"]) p = S.withCommander(p, 2, t);
  return p.name === "Meren" && p.commander === "Meren";
})());
check("clearing it puts the seat back to Player N", S.withCommander(S.withCommander(seat("Player 3"), 2, "Korvold"), 2, "").name === "Player 3");
check("a name somebody typed is left alone", S.withCommander(seat("Mike"), 2, "Korvold").name === "Mike" && S.withCommander(seat("Mike"), 2, "Korvold").commander === "Korvold");
check("and stays alone when the commander changes or clears", (() => {
  const p = S.withCommander(S.withCommander(seat("Mike"), 2, "Korvold"), 2, "Meren");
  return p.name === "Mike" && S.withCommander(p, 2, "").name === "Mike";
})());
check("a named seat shows its commander beside the name; an unnamed one shows it once",
  S.seatLabel({ ...seat("Mike", "Korvold") }) === "Mike · Korvold" && S.seatLabel({ ...seat("Korvold", "Korvold") }) === "Korvold" && S.seatLabel({ ...seat("Mike", ""), out: true }) === "Mike · out");
check("a finished game carries each seat's commander as typed", (() => {
  const g = S.gameResult([{ ...seat("Mike", " Korvold "), out: false }, { ...S.makeLifePlayer(4, "B", 40), out: true, outAt: 1 }]);
  return g.seats[0].deckName === "Korvold" && g.seats[0].deckId === null && g.winnerName === "Mike" && g.seats[1].deckName === null;
})());

// ---- on screen ----
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const { LifeCounterView } = await import("./src/features/life/LifeCounterView.jsx");

const recorded = [];
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(LifeCounterView, { onExit() {}, onRecordGame: (g) => recorded.push(g) })); });
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const all = () => [...document.querySelectorAll('button, [role="button"], input')];
const byLabel = (re) => all().find((b) => re.test(b.getAttribute("aria-label") || ""));
const byText = (t) => all().find((b) => b.textContent.trim() === t);
const type = async (el, value) => {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  await act(async () => { el[key].onChange({ target: { value } }); });
};

check("there is no deck picker any more", !byLabel(/^Decks$/));
await click(byLabel(/^Menu$/));
check("the menu has a Commander button even with no decks around", !!byLabel(/^Commander$/));
await click(byLabel(/^Commander$/));
check("it opens one text box per seat", !!document.querySelector('[aria-label="Commanders"]') && document.querySelectorAll('[aria-label="Commanders"] input').length === 4);
check("and they are free text, not a list of decks", document.querySelectorAll('[aria-label="Commanders"] select').length === 0 && !document.body.textContent.includes("Food and Fellowship"));

const settle = async () => act(async () => { await new Promise((r) => setTimeout(r, 450)); });
const modal = () => document.querySelector('[aria-label="Commanders"]').textContent;
await type(byLabel(/^Seat 1 commander$/), "Atraxa, Praetors' Voice");
await type(byLabel(/^Seat 2 commander$/), "Kor");
await settle();
check("a real card is marked as one", modal().includes("Real card"));
check("a part-typed name offers the matching cards as buttons, not a dropdown", !!byLabel(/^Seat 2 use Korvold, Fae-Cursed King$/) && !!byLabel(/^Seat 2 use Kordrazz the Test$/) && document.querySelectorAll("select").length === 0);
await click(byLabel(/^Seat 2 use Korvold, Fae-Cursed King$/));
await settle();
check("tapping one fills in the exact name", byLabel(/^Seat 2 commander$/).value === "Korvold, Fae-Cursed King");
await type(byLabel(/^Seat 3 commander$/), "Zzyzx Notacard");
await settle();
check("an unknown name is kept but says it isn't a card", byLabel(/^Seat 3 commander$/).value === "Zzyzx Notacard" && modal().includes("No card by that name"));
await type(byLabel(/^Seat 3 commander$/), "esika, god of the tree");
await settle();
check("a two-faced card is known by its front face, any case", modal().split("Real card").length === 4);
await type(byLabel(/^Seat 3 commander$/), "Sol Ring");
await settle();
check("a real card that can't be a commander says so", modal().includes("can't be a commander"));
await type(byLabel(/^Seat 3 commander$/), "Grist, the Hunger Tide");
await settle();
check("a non-creature that says it can be your commander is accepted", modal().split("Real card").length === 4 && !modal().includes("can't be a commander"));
await type(byLabel(/^Seat 3 commander$/), "");
await type(byLabel(/^Seat 2 commander$/), "Korvold");
await settle();
await click(byText("Done"));
check("the name on an unnamed seat follows the commander", !!byLabel(/^Atraxa, Praetors' Voice: 40 life/) && !!byLabel(/^Korvold: 40 life/));
check("untouched seats keep their names", !!byLabel(/^Player 3: 40 life/));

// give Player 3 a real name, then a commander: the name stays, the commander sits beside it
await click(byLabel(/^Player 3: 40 life/));
await click(byLabel(/^Player 3: rename$/));
await type(byLabel(/^Player name$/), "Mike");
await click(byText("Done"));
await click(byLabel(/^Menu$/));
await click(byLabel(/^Commander$/));
await type(byLabel(/^Seat 3 commander$/), "Meren of Clan Nel Toth");
await click(byText("Done"));
check("a named seat keeps its name", !!byLabel(/^Mike: 40 life/));
check("and shows the commander beside it", document.body.textContent.includes("Mike · Meren of Clan Nel Toth"));

// it survives a reload
const saved = JSON.parse(localStorage.getItem("hk-life-tracker"));
check("commanders are saved with the game", saved.players[0].commander === "Atraxa, Praetors' Voice" && saved.players[2].commander === "Meren of Clan Nel Toth");

// ---- partners: a switch on the seat, A and B on its tile ----
await click(byLabel(/^Mike: 40 life/));
check("a seat starts with one commander", byLabel(/^Mike: partner commanders$/).getAttribute("aria-pressed") === "false");
await click(byLabel(/^Mike: partner commanders$/));
await click(byText("Done"));
check("with partners on the seat offers commander A and B", !!byLabel(/^Mike: deal commander damage with commander A$/) && !!byLabel(/^Mike: deal commander damage with commander B$/));
check("a seat without partners doesn't", !byLabel(/^Korvold: deal commander damage with commander/));
await click(byLabel(/^Korvold: commander damage$/));
check("so the damage view offers a number per commander", !!byLabel(/^Increase commander damage from Mike \(partner\) to Korvold$/) && !!byLabel(/^Increase commander damage from Mike to Korvold$/));
await click(byLabel(/^Return to game$/));
await click(byLabel(/^Mike: deal commander damage with commander B$/));
check("picking B shows the others' damage from B", document.body.textContent.includes("Commander B") && document.body.textContent.includes("damage you've dealt"));
const hitB = byLabel(/^Increase commander damage from Mike \(partner\) to Korvold$/);
for (let i = 0; i < 3; i++) await click(hitB);
await click(byLabel(/^Return to game$/));
await click(byLabel(/^Korvold: commander damage$/));
check("and it lands on B only", [...document.querySelectorAll(".life-num")].map((n) => n.textContent).join(",").includes("3"));
await click(byLabel(/^Return to game$/));

// ---- a finished game carries the commander into the record ----
for (const who of [/^Korvold: 40 life/, /^Player 4: 40 life/]) {
  await click(byLabel(who));
  await click(byLabel(/Knock .* out of the game/));
}
await click(byLabel(/^Atraxa, Praetors' Voice: 40 life/));
await click(byLabel(/Knock .* out of the game/));
check("the last seat standing wins", /Mike wins/.test(document.body.textContent));
check("and the winner screen says whose commander goes in the record", /for Meren of Clan Nel Toth/.test(document.body.textContent));
await click(all().find((b) => /Keep the board/.test(b.textContent)));
check("one game was recorded", recorded.length === 1);
const seats = recorded[0].seats;
check("with the typed commanders, no collection deck behind them",
  seats.find((s) => s.name === "Mike").deckName === "Meren of Clan Nel Toth" && seats.every((s) => s.deckId === null) && recorded[0].winnerName === "Mike");

// ---- stats ----
check("the finished game was kept in the counter's own history", S.loadGames().length === 1 && S.loadGames()[0].winnerName === "Mike");
await click(byLabel(/^Menu$/));
check("the menu has a Stats button", !!byLabel(/^Stats$/));
await click(byLabel(/^Stats$/));
const statsText = () => document.querySelector('[aria-label="Stats"]').textContent;
check("it lists the winner by name with a win", /Mike/.test(statsText()) && /1\s*win\s*·\s*1 game/.test(statsText()));
check("and the commander that won", /Meren of Clan Nel Toth/.test(statsText()));
check("seats whose name is just the commander, or still Player N, are not listed as players", (() => {
  const players = statsText().split("Commanders")[0];
  return !/Player 4/.test(players) && !/Korvold/.test(players) && !/Atraxa/.test(players);
})());
await click(byText("Whole server"));
await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
check("the game was sent to the server when it finished", posted.length === 1 && posted[0].winnerName === "Mike" && posted[0].seats.find((x) => x.won).commander === "Meren of Clan Nel Toth");
check("and it is marked as delivered here, so it isn't sent twice", S.loadGames()[0].synced === true);
check("the server view shows everyone's games, not this device's", /Zed/.test(statsText()) && /3 finished games across everyone on this server/.test(statsText()) && !/Mike/.test(statsText().split("Recent games")[0]));
check("with per-player win counts", /Zed\s*2\s*wins\s*·\s*3 games\s*·\s*67%/.test(statsText()));
check("clearing is a this-device thing: no Clear button on the server view", !byText("Clear history"));
serverDown = true;
await click(byText("This device"));
await click(byText("Whole server"));
await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
check("when the server can't be reached it says so instead of showing nothing", /Couldn't reach the server's stats/.test(statsText()));
serverDown = false;
await click(byText("This device"));
check("and this device's own games are still there", /Mike/.test(statsText()));
await click(byText("Clear history"));
await click(byText("Really clear?"));
check("history can be cleared (after asking twice)", S.loadGames().length === 0 && /No finished games yet/.test(statsText()));
await click(byText("Done"));

const G = (id, at, win, seats) => ({ id, at, format: "commander", winnerName: win, seats });
const sd = (name, commander, won) => ({ name, commander, won });
const st = S.lifeStats([
  G("a", 3, "Mike", [sd("Mike", "Meren", true), sd("Eva", "Atraxa", false), sd("Player 3", "Korvold", false)]),
  G("b", 2, "Eva", [sd("Mike", "Meren", false), sd("Eva", "Atraxa", true)]),
  G("c", 1, "Eva", [sd("mike", "Yarok", false), sd("Eva", "Atraxa", true), sd("Korvold", "Korvold", false)]),
]);
check("players are counted by name regardless of case, most wins first", st.players[0].name === "Eva" && st.players[0].wins === 2 && st.players[0].games === 3 && st.players[0].rate === 67 && st.players[1].name === "Mike" && st.players[1].games === 3 && st.players[1].wins === 1);
check("a Player N seat or a name that is the commander is no player", st.players.length === 2);
check("commanders are tallied separately", st.commanders[0].name === "Atraxa" && st.commanders[0].wins === 2 && st.commanders.find((c) => c.name === "Korvold").games === 2);
check("recent games come newest first", st.recent[0].id === "a" && st.games === 3);
check("a game nobody won is not kept", (() => { S.saveGame({ id: "x", at: 1, winnerName: null, seats: [] }); return S.loadGames().length === 0; })());

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
