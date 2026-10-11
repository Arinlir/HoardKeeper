// Layouts, facing and the per-seat extras. jsdom has no layout engine, so what
// can be checked directly is the structure: every board arrangement is valid and
// every table size has one, each seat turns to face the side it sits on, the
// picker re-seats the table, a seat's number can be made bigger or smaller, a
// seat's colour can be changed, and the commander-damage view (with partners)
// reads and writes the right seat's numbers.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

// ---- layouts, as data ----
const S = await import("./src/features/life/lifeState.js");
check("every layout parses and is unique", S.LAYOUTS.every(Boolean) && new Set(S.LAYOUTS.map((l) => l.id)).size === S.LAYOUTS.length);
check("every table size from 2 to 10 has a layout", [2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => S.LAYOUTS.some((l) => l.seats.length === n)));
check("the default layout for a size has that many seats", [2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => S.layoutById(S.defaultLayoutFor(n))?.seats.length === n));
check("S/ss/ss is a wide seat over a two-by-two block", (() => {
  const l = S.layoutById("S/ss/ss");
  return l.seats.length === 5 && l.rows === 3 && l.seats[0].span === 2 && l.seats[1].row === 1 && l.seats[4].col === 1;
})());
check("a gap in a layout is a cell with no seat", S.layoutById(".s/ss").cells.filter((c) => c.seat === null).length === 1 && S.layoutById(".s/ss").seats.length === 3);
check("nonsense isn't a layout", S.parseLayout("sss") === null && S.parseLayout("") === null && S.parseLayout("..") === null);
check("the normal game's six-seat limit hides the bigger boards", S.layoutsFor(6).every((l) => l.seats.length <= 6) && S.layoutsFor(6).length < S.LAYOUTS.length);
const four = S.layoutById("ss/ss");
check("seats along the sides face sideways, left one way and right the other",
  S.facingOf(four.seats[0], four) === 90 && S.facingOf(four.seats[1], four) === -90 && S.facingOf(four.seats[2], four) === 90);
const stack = S.layoutById("S/S");
check("a wide seat across the top is upside down to the holder; the bottom one is upright",
  S.facingOf(stack.seats[0], stack) === 180 && S.facingOf(stack.seats[1], stack) === 0);
check("on a landscape screen only the top row turns round", S.facingOf(four.seats[1], four, true) === 180 && S.facingOf(four.seats[3], four, true) === 0);
check("each seat's minus is on its player's left, whichever way it faces",
  S.tapSides(0).dec === "left" && S.tapSides(180).dec === "right" && S.tapSides(90).dec === "top" && S.tapSides(-90).dec === "bottom");
check("an old save with no layout, colours or partners still loads", (() => {
  localStorage.setItem("hk-life-tracker", JSON.stringify({ format: "commander", players: [{ id: 1, name: "A", life: 40 }, { id: 2, name: "B", life: 40 }, { id: 3, name: "C", life: 40 }] }));
  const s = S.loadSavedLife();
  localStorage.clear();
  return s.layout === S.defaultLayoutFor(3) && s.players[2].color === S.defaultColorFor(2) && s.players[0].partner === false && s.players[0].scale === 1;
})());

// ---- on screen ----
// A phone held upright: the layouts are drawn for portrait. (jsdom's default
// window is landscape, which would turn the seats the tablet way.)
const setWindow = (w, h) => {
  Object.defineProperty(dom.window, "innerWidth", { value: w, configurable: true });
  Object.defineProperty(dom.window, "innerHeight", { value: h, configurable: true });
};
setWindow(390, 800);
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const all = () => [...document.querySelectorAll('button, [role="button"]')];
const byLabel = (re) => all().find((b) => re.test(b.getAttribute("aria-label") || ""));
const byText = (t) => all().find((b) => b.textContent.trim() === t);
const nums = () => [...document.querySelectorAll(".life-num")];
const openMenu = async () => { if (!document.querySelector('[aria-label="Life counter menu"]')) await click(byLabel(/^Menu$/)); };
const tile = (i) => document.querySelector(`[data-seat="${i}"]`);
const turned = (i) => (tile(i).innerHTML.match(/rotate\((-?\d+)deg\)/) || [])[1];

await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Life"));

check("four seats: the left ones read sideways one way, the right ones the other",
  turned(0) === "90" && turned(1) === "-90" && turned(2) === "90" && turned(3) === "-90");
check("every seat is its own coloured tile", [0, 1, 2, 3].every((i) => !!tile(i)) && new Set([0, 1, 2, 3].map((i) => tile(i).style.backgroundColor)).size === 4);

// ---- the layout picker ----
await openMenu();
await click(all().find((b) => /Layout/.test(b.textContent)));
check("the menu's Layout button opens the picker", !!document.querySelector('[aria-label="Choose a layout"]'));
check("every layout is there as a button", document.querySelectorAll('[aria-label="Choose a layout"] [aria-label*=", layout "]').length === S.LAYOUTS.length);
check("the one in use is marked", document.querySelectorAll('[aria-pressed="true"][aria-label*="layout ss/ss"]').length === 1);
await click(byLabel(/^5 players, layout S\/ss\/ss$/));
check("picking one re-seats the table (five seats, the new one added)", nums().length === 5 && !document.querySelector('[aria-label="Choose a layout"]'));
check("the wide seat on top is upside down", turned(0) === "180");
check("and the layout is remembered", JSON.parse(localStorage.getItem("hk-life-tracker")).layout === "S/ss/ss");
await openMenu();
await click(all().find((b) => /Layout/.test(b.textContent)));
await click(byLabel(/^3 players, layout \.s\/ss$/));
check("fewer seats drops the last players", nums().length === 3);
// undo puts the layout back along with the players
await openMenu();
await click(byLabel(/^Undo$/));
check("undo restores the layout too", nums().length === 5);

// normal games top out at six
await openMenu();
await click(byText("normal · 20"));
await click(all().find((b) => /Layout/.test(b.textContent)));
check("a normal game's picker has no layout above six seats", !byLabel(/^10 players/) && !!byLabel(/^6 players/));
await click(byLabel(/^Close layouts$/));
await openMenu();
await click(byText("commander · 40"));
await click(byLabel(/^Close$/));

// ---- colour and size ----
await openMenu();
await click(byLabel(/^Remove player$/)); // 5 -> 4 players, back on the tidy block
await click(byLabel(/^Close$/));
await click(byLabel(/^Player 1: 40 life/));
await click(byLabel(/^Player 1: background$/));
check("a seat's background is a row of swatches, buttons not a dropdown", !!byLabel(/^Player 1: colour #2F6DB0$/) && !!byLabel(/^Player 1: stars background$/));
await click(byLabel(/^Player 1: colour #2F6DB0$/));
check("the chosen swatch is marked", byLabel(/^Player 1: colour #2F6DB0$/).getAttribute("aria-pressed") === "true");
await click(byText("Back"));
await click(byText("Done"));
check("picking one recolours the seat", /2f6db0|47, ?109, ?176/i.test(tile(0).style.backgroundColor));
check("and a dark colour gets white numbers", nums()[0].style.color.replace(/\s/g, "") === "rgb(255,255,255)" || nums()[0].style.color.toLowerCase() === "#ffffff");
await click(byLabel(/^Player 1: 40 life/));
await click(byLabel(/^Player 1: background$/));
await click(byLabel(/^Player 1: stars background$/));
await click(byText("Back"));
await click(byText("Done"));
check("the stars theme is a background too", /gradient|svg/.test(tile(0).style.backgroundImage));
await click(byLabel(/^Player 1: 40 life/));
const sizeOf = () => parseFloat(nums()[0].style.fontSize);
const before = sizeOf();
await click(byLabel(/^Player 1: smaller number$/));
check("a seat's number can be made smaller", sizeOf() < before);
await click(byLabel(/^Player 1: bigger number$/));
await click(byLabel(/^Player 1: bigger number$/));
check("and bigger", sizeOf() > before);
await click(byLabel(/^Turn Player 1's seat around$/));
check("a seat can be turned around", turned(0) === "-90");
await click(byLabel(/^Turn Player 1's seat around$/));
await click(byText("Done"));
check("done closes the panel", !document.querySelector('[aria-label="Player 1: seat options"]'));

// ---- commander damage ----
await click(byLabel(/^Player 1: commander damage$/));
check("the sword chip opens commander damage for that seat", !!byLabel(/^Return to game$/) && document.body.textContent.includes("damage you've received"));
check("the other three seats each show what they've dealt", nums().length === 3 && nums().every((n) => n.textContent === "0"));
const more = byLabel(/^Increase commander damage from Player 2 to Player 1$/);
for (let i = 0; i < 3; i++) await click(more);
check("tapping adds damage from that seat", nums().map((n) => n.textContent).join() === "3,0,0");
await click(byLabel(/^Decrease commander damage from Player 2 to Player 1$/));
check("and takes it back", nums()[0].textContent === "2");
await click(byLabel(/^Return to game$/));
check("returning shows the life totals again, with the hit on the chip", nums().length === 4 && byLabel(/^Player 1: commander damage$/).textContent.includes("2"));
check("commander damage doesn't touch life", nums()[0].textContent === "40");

// ---- partners ----
await click(byLabel(/^Player 2: 40 life/));
await click(byLabel(/^Player 2: partner commanders$/));
check("partners is a switch", byLabel(/^Player 2: partner commanders$/).getAttribute("aria-pressed") === "true");
await click(byText("Done"));
await click(byLabel(/^Player 1: commander damage$/));
check("a partner pair gets two commander-damage numbers", !!byLabel(/^Increase commander damage from Player 2 \(partner\) to Player 1$/));
const morePartner = byLabel(/^Increase commander damage from Player 2 \(partner\) to Player 1$/);
for (let i = 0; i < 21; i++) await click(morePartner);
await click(byLabel(/^Return to game$/));
check("21 from the second commander alone is lethal", document.body.textContent.includes("21 commander damage"));
await click(byLabel(/^Player 2: 40 life/));
await click(byLabel(/^Player 2: partner commanders$/));
await click(byText("Done"));
check("switching partners off forgets that commander's damage", !document.body.textContent.includes("21 commander damage"));

// ---- a tablet or a browser window is the other way round ----
await click(byLabel(/^Return to game$/) || byLabel(/^Menu$/));
setWindow(1280, 720);
await act(async () => { dom.window.dispatchEvent(new dom.window.Event("resize")); });
check("on a landscape screen the top row turns round and the rest stand upright", turned(0) === "180" && turned(1) === "180" && turned(2) === "0" && turned(3) === "0");

check("the whole screen has no dropdown", document.querySelectorAll("select").length === 0);

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
