// Verifies: the Playgroup tab as it renders -- it reads the public pages of
// the other profiles on the server (never their vaults), shows both sides of a
// match, and says something sensible when there's nobody there.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const asked = [];
let profiles = { profiles: ["arin", "kevin", "sam"], public: [] };
const payloads = {
  kevin: {
    profile: "kevin",
    wishlist: [{ id: "k1", name: "Rhystic Study", quantity: 1, priority: "high" }],
    trade: [{ id: "t1", name: "Cyclonic Rift", set: "mm3", quantity: 1, usd: 25, finish: "nonfoil" }],
  },
  sam: { profile: "sam", wishlist: [{ id: "s1", name: "Timetwister", quantity: 1 }], trade: [] },
};
globalThis.fetch = (url) => {
  const u = String(url);
  asked.push(u);
  if (u.includes("/api/profiles")) return Promise.resolve({ ok: true, json: async () => profiles });
  const m = u.match(/\/api\/public\/wishlist\/(\w+)/);
  if (m && payloads[m[1]]) return Promise.resolve({ ok: true, json: async () => payloads[m[1]] });
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
};

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
const { PlaygroupView } = await import("./src/features/playgroup/PlaygroupView.jsx");

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const cards = [
  { id: "c1", name: "Rhystic Study", set: "prp", quantity: 1, usd: 30, forTrade: true },
  { id: "c2", name: "Mana Crypt", set: "2xm", quantity: 1, usd: 200, proxy: true },
];
const wishlist = [{ id: "w1", name: "Cyclonic Rift", quantity: 1, priority: "high" }];

const root = createRoot(document.getElementById("root"));
await act(async () => {
  root.render(React.createElement(PlaygroupView, { cards, wishlist, profileName: "arin", publicTrade: true, onOpenSettings: () => {} }));
});
await act(async () => { await new Promise((r) => setTimeout(r, 40)); });

const text = () => document.body.textContent;

check("it asks who else is here", asked.some((u) => u.includes("/api/profiles")));
check("it reads their public wishlists", asked.some((u) => u.includes("/api/public/wishlist/kevin")));
check("it never asks for anyone's vault", !asked.some((u) => u.includes("/api/store/")));
check("it doesn't ask about itself", !asked.some((u) => u.includes("/wishlist/arin")));
check("a match is shown", text().includes("kevin") && text().includes("Rhystic Study"));
check("both directions are shown", text().includes("Cyclonic Rift"));
check("a two-way match is called a swap", text().includes("Swap"));
check("a copy you marked for trade is labelled", text().toLowerCase().includes("on your trade list"));
check("a proxy is not offered to anyone", !text().includes("Mana Crypt"));
check("someone with no overlap isn't listed", !text().includes("Timetwister"));
check("there is nothing to edit here — it's a reading of shared pages", (() => {
  const labels = [...document.querySelectorAll("button")].map((b) => (b.textContent || "").toLowerCase());
  return !labels.some((l) => /delete|remove|add card|sell/.test(l));
})());

// ---- nobody else on the server ----
profiles = { profiles: ["arin"], public: [] };
const host = document.createElement("div");
document.body.appendChild(host);
const root2 = createRoot(host);
await act(async () => {
  root2.render(React.createElement(PlaygroupView, { cards, wishlist, profileName: "arin", publicTrade: true, onOpenSettings: () => {} }));
});
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
check("a lone profile is told how this works rather than shown an empty grid", host.textContent.includes("public handle") && host.textContent.toLowerCase().includes("when a friend"));

// ---- your own trade list not shared ----
const host2 = document.createElement("div");
document.body.appendChild(host2);
const root3 = createRoot(host2);
await act(async () => {
  root3.render(React.createElement(PlaygroupView, { cards, wishlist, profileName: "arin", publicTrade: false, onOpenSettings: () => {} }));
});
await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
check("not sharing your own list is pointed out, with the way to fix it", host2.textContent.includes("isn't shared") && host2.textContent.includes("Settings"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
