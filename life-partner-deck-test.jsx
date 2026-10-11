// A seat whose deck has two commanders gets its Partners switch turned on when
// the deck is assigned, so commander damage is counted for each commander; a
// one-commander deck turns it off again.
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
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const { LifeCounterView } = await import("./src/features/life/LifeCounterView.jsx");

const decks = [
  { id: "d1", name: "Food and Fellowship", commanderId: "a", partnerId: "b" },
  { id: "d2", name: "Riders of Rohan", commanderId: "c" },
];
const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(LifeCounterView, { onExit() {}, decks })); });
const click = async (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const all = () => [...document.querySelectorAll('button, [role="button"]')];
const byLabel = (re) => all().find((b) => re.test(b.getAttribute("aria-label") || ""));
const deckBtn = (name) => all().find((b) => b.textContent.trim() === name);
const partnerOn = async () => {
  await click(byLabel(/^Player 1: 40 life/));
  const on = byLabel(/^Player 1: partner commanders$/).getAttribute("aria-pressed") === "true";
  await click(all().find((b) => b.textContent.trim() === "Done"));
  return on;
};

check("partners starts off", (await partnerOn()) === false);

await click(byLabel(/^Menu$/));
await click(byLabel(/^Decks$/));
await click(deckBtn("Food and Fellowship")); // first one is Player 1's
await click(all().find((b) => b.textContent.trim() === "Done"));
check("assigning a two-commander deck switches Partners on", (await partnerOn()) === true);

// hits from the second commander are kept apart from the first's
await click(byLabel(/^Player 2: commander damage$/));
check("so the damage view offers a number per commander", !!byLabel(/^Increase commander damage from Player 1 \(partner\) to Player 2$/) && !!byLabel(/^Increase commander damage from Player 1 to Player 2$/));
await click(byLabel(/^Return to game$/));

// the seat itself offers its two commanders; picking one deals damage with it
check("the partnered seat shows commander A and B on its own tile", !!byLabel(/^Player 1: deal commander damage with commander A$/) && !!byLabel(/^Player 1: deal commander damage with commander B$/));
check("a seat without partners doesn't", !byLabel(/^Player 2: deal commander damage with commander/));
await click(byLabel(/^Player 1: deal commander damage with commander B$/));
check("picking B shows the others' damage from B, with Player 1's own seat as the card", document.body.textContent.includes("Commander B") && document.body.textContent.includes("damage you've dealt"));
const hitB = byLabel(/^Increase commander damage from Player 1 \(partner\) to Player 2$/);
check("each opponent gets a counter for it", !!hitB && !!byLabel(/^Increase commander damage from Player 1 \(partner\) to Player 3$/));
for (let i = 0; i < 3; i++) await click(hitB);
await click(byLabel(/^Return to game$/));
await click(byLabel(/^Player 2: commander damage$/));
const fromA = document.querySelector('[aria-label="Increase commander damage from Player 1 to Player 2"]');
check("Player 2's own view lists both, with the 3 on B only", !!fromA && !!byLabel(/^Increase commander damage from Player 1 \(partner\) to Player 2$/) && [...document.querySelectorAll(".life-num")].map((n) => n.textContent).join(",").includes("3"));
await click(byLabel(/^Return to game$/));

await click(byLabel(/^Menu$/));
await click(byLabel(/^Decks$/));
await click(deckBtn("Riders of Rohan"));
await click(all().find((b) => b.textContent.trim() === "Done"));
check("a one-commander deck switches it off again", (await partnerOn()) === false);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
