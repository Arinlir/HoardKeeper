// The Life Counter's rules and what you can do on the board: optional counters,
// the exact-total keypad (reached through a seat's own panel), undo, elimination
// and the win call, table markers, dice, and room for ten players. Everything is
// a button — there isn't a dropdown in the thing.
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

// ---- 1. the rules, on their own ----
const S = await import("./src/features/life/lifeState.js");

check("21 commander damage is lethal", S.lethalReason({ life: 30, cmdDmg: { 2: 21 }, counters: {} }) === "21 commander damage");
check("and a partner commander's damage counts on its own, not added to the first's",
  S.lethalReason({ life: 30, cmdDmg: { 2: 15, "2b": 21 }, counters: {} }) === "21 commander damage" &&
  S.lethalReason({ life: 30, cmdDmg: { 2: 15, "2b": 15 }, counters: {} }) === null);
check("poison only counts when the table tracks it",
  S.lethalReason({ life: 30, cmdDmg: {}, counters: { poison: 10 } }) === null &&
  S.lethalReason({ life: 30, cmdDmg: {}, counters: { poison: 10 } }, ["poison"]) === "10 poison");
check("zero life is lethal too", S.lethalReason({ life: 0, cmdDmg: {}, counters: {} }) === "0 life");
check("a healthy player isn't", S.lethalReason({ life: 12, cmdDmg: { 2: 3 }, counters: {} }) === null);
check("the worst single hit is what the sword chip shows", S.maxCmdDamage({ cmdDmg: { 1: 4, "1b": 9, 3: 2 } }) === 9);

const two = [S.makeLifePlayer(1, "A", 40), S.makeLifePlayer(2, "B", 40)];
check("no winner while everyone's in", !S.winnerOf(two));
check("last one standing wins", S.winnerOf([{ ...two[0], out: true }, two[1]])?.name === "B");
check("a one-seat table is never 'won'", !S.winnerOf([{ ...two[0], out: false }]));
check("every seat starts with its own colour", new Set([1, 2, 3, 4].map((i) => S.makeLifePlayer(i, "x", 40).color)).size === 4);
check("black ink on bright colours, white on dark ones (and on the night sky)", S.inkFor("#E6D9A8") === "#000000" && S.inkFor("#2F6DB0") === "#FFFFFF" && S.inkFor("stars") === "#FFFFFF");
check("a bigger number is clamped to what a seat can show", S.clampScale(9) === S.SCALE_MAX && S.clampScale(0) === S.SCALE_MIN);

// a scripted d20: 20, 20, 3 → the first two tie and reroll, then B takes it
const scripted = (values) => {
  let i = 0;
  return () => (values[i++ % values.length] - 1) / 20;
};
const hr = S.highRoll(
  [S.makeLifePlayer(1, "A", 40), S.makeLifePlayer(2, "B", 40), S.makeLifePlayer(3, "C", 40)],
  scripted([20, 20, 3, 5, 19])
);
check("a high roll rerolls a tie among the tied players", hr.rounds.length === 2 && hr.rounds[1].rolls.length === 2);
check("and names who starts", hr.winner?.name === "B");
check("each seat is shown its last roll", JSON.stringify(S.rollsById(hr)) === JSON.stringify({ 1: 5, 2: 19, 3: 3 }));
check("players who are out don't roll for turn order",
  S.highRoll([{ ...S.makeLifePlayer(1, "A", 40), out: true }, S.makeLifePlayer(2, "B", 40)], scripted([7])).rounds[0].rolls.length === 1);
const rolls = Array.from({ length: 60 }, () => S.rollDie(6));
check("a die stays on its own faces", rolls.every((r) => r >= 1 && r <= 6) && new Set(rolls).size > 1);

// ---- 2. the board on screen ----
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
const lifeNumbers = () => [...document.querySelectorAll(".life-num")].map((el) => el.textContent.trim());
const openMenu = async () => { if (!document.querySelector('[aria-label="Life counter menu"]')) await click(byLabel(/^Menu$/)); };
const closeMenu = async () => { if (document.querySelector('[aria-label="Life counter menu"]')) await click(byLabel(/^Close$/)); };

const lifeTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Life");
await click(lifeTab);

check("no dropdown anywhere in the life counter", document.querySelectorAll("select").length === 0);
check("four seats at 40 to start", lifeNumbers().join() === "40,40,40,40");

// counters are off until the table turns them on
check("counters start off", !document.body.textContent.includes("POISON"));
await openMenu();
check("each counter has its own switch", !!byText("Poison") && !!byText("Energy") && !!byText("Commander tax"));
await click(byText("Poison"));
await click(byText("Commander tax"));
await closeMenu();
check("switching poison on gives every seat a poison counter", document.querySelectorAll("[aria-label$='more poison']").length === 4);

const morePoison = byLabel(/^Player 1: more poison$/);
for (let i = 0; i < 3; i++) await click(morePoison);
check("poison counts up", morePoison.parentElement.textContent.includes("3"));
await click(byLabel(/^Player 1: fewer poison$/));
check("and back down", morePoison.parentElement.textContent.includes("2"));

// commander tax moves two at a time, because that's how the tax works
const moreTax = byLabel(/^Player 1: more commander tax$/);
await click(moreTax);
check("commander tax steps by two", moreTax.parentElement.textContent.includes("2"));

// ---- 3. typing an exact total — through the seat's own panel ----
await click(byLabel(/^Player 1: 40 life/));
check("tapping the number opens that seat's panel", !!document.querySelector('[aria-label="Player 1: seat options"]'));
check("the panel has the four things from the design: background, kill, partners, name",
  !!byLabel(/^Player 1: background$/) && !!byLabel(/^Knock Player 1 out/) && !!byLabel(/^Player 1: partner commanders$/) && !!byLabel(/^Player 1: rename$/));
await click(byLabel(/^Player 1: type an exact total$/));
check("keypad opened", !!document.querySelector('[aria-label="Set life for Player 1"]'));
check("and the panel got out of its way", !document.querySelector('[aria-label="Player 1: seat options"]'));
await click(byText("2"));
await click(byText("7"));
const setTotal = all().find((b) => /^Set total to 27$/.test(b.textContent.trim()));
check("it offers to set the exact total typed", !!setTotal);
await click(setTotal);
check("the total is set, not added", lifeNumbers()[0] === "27");
check("the keypad closed itself", !document.querySelector('[aria-label="Set life for Player 1"]'));

// ---- 4. undo ----
await openMenu();
await click(byLabel(/^Undo$/));
check("undo puts the life total back", lifeNumbers()[0] === "40");
check("and shuts the menu so you can see it", !document.querySelector('[aria-label="Life counter menu"]'));

// ---- 5. table markers ----
await click(byLabel(/^Player 2: 40 life/));
await click(byLabel(/Give the crown to Player 2/));
check("the crown can be handed to a seat, and it stays there", !!byLabel(/Take the crown from Player 2/));
await click(byLabel(/Close|^Done$/) || byText("Done"));
check("the crown shows on the seat once the panel is shut", !!document.querySelector('[aria-label="Player 2 is the monarch"]'));
await openMenu();
await click(byLabel(/^Day\/Night$/));
check("day/night is one button, cycling", !!byLabel(/^day$/));
await closeMenu();
check("and the hub shows which it is", !!document.querySelector('[aria-label="It is day"]'));
await openMenu();

// ---- 6. dice ----
await click(byLabel(/^Dice$/));
check("dice panel opens", !!document.querySelector('[aria-label="Dice and coin"]'));
check("every die is a button", ["d4", "d6", "d8", "d10", "d12", "d20"].every((d) => !!byText(d)));
await click(byText("d20"));
// textContent runs the panel's elements together, so read the number itself
const rolled = Number((document.body.textContent.match(/d20 rolled (\d+)/) || [])[1]);
check("rolling a d20 reports a result between 1 and 20", rolled >= 1 && rolled <= 20);
await click(all().find((b) => /Coin flip/.test(b.textContent)));
check("the coin comes up one way or the other", /Coin came up (Heads|Tails)/.test(document.body.textContent));
// who starts is played out on the board: seats go dark, the winner lights up
await click(all().find((b) => /Who starts/.test(b.textContent)));
check("who-starts closes the dice and shows each seat's roll", !document.querySelector('[aria-label="Dice and coin"]') && lifeNumbers().length === 4 && lifeNumbers().every((n) => /^\d+$/.test(n) && +n >= 1 && +n <= 20));
check("and says who starts", /starts|Tied/.test(document.body.textContent));
check("the hub closes the roll", !!byLabel(/^Close$/));
await click(byLabel(/^Close$/));
check("back to the game with the real totals", lifeNumbers().join() === "40,40,40,40");

// ---- 7. the log kept all of that ----
await openMenu();
await click(byLabel(/^Log$/));
const logText = document.querySelector('[aria-label="Game log"]').textContent;
check("the log records the roll", /d20 rolled/.test(logText));
check("the log records the who-starts roll", /wins the roll|Still tied/.test(logText));
check("the log records the crown changing hands", /takes monarch/.test(logText));
check("the log records the undo", /Undid the last change/.test(logText));
await click(byLabel(/^Close$/));

// ---- 8. ten seats ----
await openMenu();
for (let i = 0; i < 6; i++) await click(byLabel(/^Add player$/));
check("commander tables go up to ten", lifeNumbers().length === 10);
check("and stop there", byLabel(/^Add player$/).disabled === true);

// ---- 9. knocking players out, and the win call ----
for (let i = 0; i < 8; i++) await click(byLabel(/^Remove player$/));
check("back down to two", lifeNumbers().length === 2);
await closeMenu();
check("no winner yet", !document.body.textContent.includes("wins"));
await click(byLabel(/^Player 1: 40 life/));
await click(byLabel(/Knock Player 1 out of the game/));
check("the last player standing wins", /Player 2 wins/.test(document.body.textContent));
await click(all().find((b) => /Keep the board/.test(b.textContent)));
check("the win notice can be dismissed without resetting", !/Player 2 wins/.test(document.body.textContent) && lifeNumbers().length === 2);
check("a player who's out can be brought back", !!byLabel(/Bring Player 1 back into the game/));

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
