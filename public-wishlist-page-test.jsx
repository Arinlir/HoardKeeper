// The /w/<profile> page renders for someone with no profile, no PIN and no
// stored data — it asks the server for one wishlist and shows it, and says
// something sensible when there's nothing at that address.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/w/michael" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let asked = [];
let respond = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    profile: "michael",
    currency: "USD",
    wishlist: [
      { id: "w1", name: "Mana Crypt", set: "", collectorNumber: "", usd: 80, quantity: 2, priority: "high", note: "birthday", finish: "nonfoil" },
    ],
    replacing: [
      { id: "c3", name: "Rhystic Study", set: "prp", collectorNumber: "45", usd: 30, quantity: 1, priority: "normal", note: "foil please", proxy: true, finish: "nonfoil" },
    ],
  }),
});
globalThis.fetch = (url) => {
  asked.push(String(url));
  return Promise.resolve(respond());
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const { PublicWishlist } = await import("./src/features/wishlist/PublicWishlist.jsx");

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const root = createRoot(document.getElementById("root"));
await act(async () => { root.render(React.createElement(PublicWishlist, { name: "michael" })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const text = document.body.textContent;
check("asks the public endpoint, not the vault", asked.some((u) => u.includes("/api/public/wishlist/michael")) && !asked.some((u) => u.includes("/api/store")));
check("names whose list this is", text.includes("michael's wishlist"));
check("shows a wanted card", text.includes("Mana Crypt"));
check("shows its note", text.includes("birthday"));
check("marks the top of the list", text.includes("Top of the list"));
check("shows the quantity wanted", text.includes("x2"));
check("shows a card being replaced", text.includes("Rhystic Study"));
check("says that one's a proxy right now", text.includes("Playing a proxy"));
check("says what's private", text.toLowerCase().includes("stay private"));
check("no sign-in anywhere on the page", !/enter pin|sign in|profile name/i.test(text));

// a link to a profile that doesn't exist
asked = [];
respond = () => ({ ok: false, status: 404, json: async () => ({ error: "No such wishlist" }) });
const host = document.createElement("div");
document.body.appendChild(host);
const root3 = createRoot(host);
await act(async () => { root3.render(React.createElement(PublicWishlist, { name: "nobody" })); });
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
check("a missing wishlist says so plainly", host.textContent.includes("There's no wishlist at this address"));

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
