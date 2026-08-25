// Verifies the click-through preview: clicking a tile (owned or missing)
// opens a large lightbox view; a card with multiple printings can be paged
// through with prev/next, correctly cycling with wraparound; each printing
// shown reflects its own owned status and quantity; adding/removing a copy
// from inside the lightbox works on the specific printing being viewed;
// and closing works via the backdrop or the Close button.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));

// own only the showcase printing of Capitoline Triad; own nothing of Murder
const cards = [
  { id: "c1", name: "Capitoline Triad", set: "acr", collectorNumber: "245", scryfallId: "triad-showcase", quantity: 1, usd: 5, colors: [], rarity: "rare", typeLine: "Creature", collectionId: "uncategorized", added: 1 },
];
let putCalls = [];
globalThis.fetch = (url, opts) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael") && opts?.method === "PUT") {
    putCalls.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
  }
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards }) }) });
  if (u.includes("api.scryfall.com/sets/"))
    return Promise.resolve({ ok: true, json: async () => ({ name: "Assassin's Creed", code: "acr", card_count: 4, released_at: "2024-01-01" }) });
  if (u.includes("api.scryfall.com/cards/search"))
    return Promise.resolve({
      ok: true,
      json: async () => ({
        data: [
          { object: "card", id: "triad-normal", name: "Capitoline Triad", set: "acr", set_name: "Assassin's Creed", collector_number: "12", rarity: "rare", type_line: "Creature", image_uris: { normal: "http://x/a.jpg", large: "http://x/a-large.jpg" }, prices: { usd: "5.00" } },
          { object: "card", id: "triad-showcase", name: "Capitoline Triad", set: "acr", set_name: "Assassin's Creed", collector_number: "245", rarity: "rare", type_line: "Creature", image_uris: { normal: "http://x/b.jpg", large: "http://x/b-large.jpg" }, prices: { usd: "12.00" } },
          { object: "card", id: "triad-borderless", name: "Capitoline Triad", set: "acr", set_name: "Assassin's Creed", collector_number: "301", rarity: "rare", type_line: "Creature", image_uris: { normal: "http://x/c.jpg", large: "http://x/c-large.jpg" }, prices: { usd: "18.00" } },
          { object: "card", id: "murder-1", name: "Murder", set: "acr", set_name: "Assassin's Creed", collector_number: "92", rarity: "uncommon", type_line: "Instant", image_uris: { normal: "http://x/d.jpg", large: "http://x/d-large.jpg" }, prices: { usd: "6.00" } },
        ],
        has_more: false,
      }),
    });
  return Promise.resolve({ ok: false, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const App = (await import("./src/App.jsx")).default;

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(App)); });
await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

const setsTab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Sets");
await act(async () => { setsTab.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
const setRow = [...document.querySelectorAll("div")].find(
  (d) => d.textContent.includes("Assassin's Creed") && (d.getAttribute("style") || "").includes("cursor: pointer")
);
await act(async () => { setRow.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

// --- open the preview for the owned, multi-printing card ---
const triadNameEl = document.querySelector('[title="Capitoline Triad"]');
check("found the Capitoline Triad tile", !!triadNameEl);
await act(async () => { triadNameEl.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

let text = document.body.textContent;
// the owned printing (showcase) is at array index 1 (normal=0, showcase=1,
// borderless=2), so it correctly opens labeled "version 2 of 3"
check("lightbox opened, shows the card name", text.includes("Capitoline Triad") && text.includes("version 2 of 3"));
check("opens on the OWNED printing (showcase, #245), not always the first one", text.includes("#245"));
check("marks the currently-shown printing as owned", text.includes("· owned"));

// --- page forward through the versions ---
const nextBtn = document.querySelector('button[title="Next version"]');
check("next-version button present (multiple printings)", !!nextBtn);
await act(async () => { nextBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
text = document.body.textContent;
check("paged forward to version 3 of 3 (borderless)", text.includes("version 3 of 3") && text.includes("#301"));
check("borderless printing is correctly NOT marked owned", !text.includes("· owned"));

await act(async () => { nextBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
text = document.body.textContent;
check("wraps around past the last printing to version 1 of 3 (normal)", text.includes("version 1 of 3") && text.includes("#12"));
check("normal printing also correctly NOT marked owned", !text.includes("· owned"));

await act(async () => { nextBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
text = document.body.textContent;
check("paging forward again returns to the owned showcase printing", text.includes("version 2 of 3") && text.includes("#245") && text.includes("· owned"));

// --- add a copy of the CURRENTLY VIEWED (unowned, borderless) printing ---
const prevBtn = document.querySelector('button[title="Previous version"]');
await act(async () => { prevBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); // back to version 1 (normal, unowned)
await act(async () => { prevBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); // back to version 3 (borderless, unowned)
text = document.body.textContent;
check("navigated back to the borderless printing before adding it", text.includes("#301"));
const plusBtns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "+");
const lightboxPlus = plusBtns[plusBtns.length - 1]; // the lightbox's own stepper
await act(async () => { lightboxPlus.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
await act(async () => { await new Promise((r) => setTimeout(r, 700)); });

const saved = putCalls.length ? JSON.parse(putCalls[putCalls.length - 1].value).cards : [];
check("adding from the lightbox added the SPECIFIC printing being viewed (borderless)", saved.some((c) => c.scryfallId === "triad-borderless"));
check("original owned showcase printing untouched", saved.some((c) => c.scryfallId === "triad-showcase" && c.quantity === 1));

// --- close via backdrop ---
const backdrop = [...document.querySelectorAll("div")].find((d) => (d.getAttribute("style") || "").includes("z-index: 70"));
check("found the lightbox backdrop", !!backdrop);
await act(async () => { backdrop.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("lightbox closed after clicking the backdrop", !document.body.textContent.includes("version 1 of 3") && !document.body.textContent.includes("version 3 of 3"));

// --- a single-printing (missing) card has no paging controls ---
const murderNameEl = document.querySelector('[title="Murder"]');
await act(async () => { murderNameEl.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("single-printing card preview has no next/prev buttons", !document.querySelector('button[title="Next version"]'));
check("still clearly shows the missing card's name and info", document.body.textContent.includes("Murder") && document.body.textContent.includes("#92"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
