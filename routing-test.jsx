// Tabs live in the URL (/decks, … "/" is the collection) and a modal only
// closes on a click that began on its own backdrop.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window.document, "oninput", { value: null, writable: true, configurable: true });

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { parsePath, pathFor } from "./src/lib/router.js";
import { ModalShell } from "./src/components/ui/ModalShell.jsx";

let fails = 0;
const check = (name, ok) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) fails++; };

// --- pure routing helpers
check("/ is the collection", parsePath("/").view === "collection");
check("/collection also resolves (old links)", parsePath("/collection").view === "collection");
check("/decks", parsePath("/decks").view === "decks" && parsePath("/decks").deckId === null);
check("/decks/abc carries the deck id", parsePath("/decks/abc").deckId === "abc");
check("unknown path is notfound", parsePath("/nope").view === "notfound" && parsePath("/decks/a").view === "decks");
check("pathFor collection is /", pathFor("collection") === "/");
check("pathFor decks + id", pathFor("decks", "d 1") === "/decks/d%201");
check("round trip", parsePath(pathFor("decks", "d 1")).deckId === "d 1");

// --- modal backdrop
const root = createRoot(document.getElementById("root"));
let closed = 0;
await act(async () => {
  root.render(React.createElement(ModalShell, { title: "T", onClose: () => { closed++; } }, React.createElement("input", { id: "x" })));
});
const backdrop = document.querySelector('[data-role="modal-backdrop"]');
const input = document.getElementById("x");
const ev = (t, n) => t.dispatchEvent(new dom.window.MouseEvent(n, { bubbles: true }));
await act(async () => { ev(input, "mousedown"); ev(backdrop, "mouseup"); ev(backdrop, "click"); });
check("press inside + release on backdrop does NOT close", closed === 0);
await act(async () => { ev(input, "mousedown"); ev(input, "mouseup"); ev(input, "click"); });
check("click inside does not close", closed === 0);
await act(async () => { ev(backdrop, "mousedown"); ev(backdrop, "mouseup"); ev(backdrop, "click"); });
check("a real backdrop click closes", closed === 1);
await act(async () => { ev(backdrop, "click"); });
check("a bare click event on the backdrop still closes", closed === 2);

process.exit(fails ? 1 : 0);
