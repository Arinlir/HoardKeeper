// Verifies the phone app's live scanner without a phone: the frame→screen
// mapping, picking the collector line out of a frame's text, the two-frame
// agreement rule, and the overlay itself driven by a fake native plugin that
// replays "textRecognized" events the way ML Kit / Apple Vision send them.
// Also checks the Android back-button routing (lib/nativeShell.js).
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "https://localhost/",
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.Event = dom.window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(dom.window, "innerWidth", { value: 390, configurable: true });
Object.defineProperty(dom.window, "innerHeight", { value: 844, configurable: true });

import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { parseCollectorLine } from "./src/lib/ocr.js";
import { REPEAT_GAP_MS } from "./src/features/collection/modals/LiveScanOverlay.jsx";
import { candidatesFromFrame, createStabilizer, frameToView, guideRect, linesInRegion } from "./src/lib/liveScan.js";
import { ScanCardTab } from "./src/features/collection/modals/ScanCardTab.jsx";
import { decideBack } from "./src/lib/nativeShell.js";
import { nameMatches, createResolver } from "./src/lib/scanResolve.js";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- geometry ----
// A 1080×1920 portrait frame on a 390×844 screen: height-limited cover.
const frame = { w: 1080, h: 1920 };
const view = { w: 390, h: 844 };
const scale = Math.max(390 / 1080, 844 / 1920);
const c = frameToView(0.5, 0.5, frame, view);
check("frame centre lands on the screen centre", Math.abs(c.x - 195) < 0.01 && Math.abs(c.y - 422) < 0.01);
const tl = frameToView(0, 0, frame, view);
check("the frame is cropped at the sides, not squashed", tl.x < 0 && Math.abs(tl.y) < 0.01 && Math.abs(scale - 844 / 1920) < 1e-9);

const g = guideRect(390, 844);
check("guide is card-shaped", Math.abs(g.width / g.height - 63 / 88) < 0.001);
check("guide fits between the top bar and bottom panel", g.top >= 72 && g.bottom <= 844 - 150 + 0.01 && g.left >= 19.9);

// Build a frame line from SCREEN coordinates, so the test reads naturally.
function lineAt(text, sx1, sy1, sx2, sy2) {
  const s = Math.max(view.w / frame.w, view.h / frame.h);
  const offX = (frame.w * s - view.w) / 2;
  const offY = (frame.h * s - view.h) / 2;
  const fx = (x) => (x + offX) / (frame.w * s);
  const fy = (y) => (y + offY) / (frame.h * s);
  return { text, left: fx(sx1), right: fx(sx2), top: fy(sy1), bottom: fy(sy2) };
}
const inGuideBottom = (text, row = 0) =>
  lineAt(text, g.left + 12, g.bottom - 30 + row * 10, g.left + 120, g.bottom - 22 + row * 10);

const kept = linesInRegion([inGuideBottom("0245 U"), lineAt("outside", 2, 2, 30, 12)], frame, view, g);
check("lines outside the guide are dropped", kept.length === 1 && kept[0].text === "0245 U");
check("…and a kept line knows it's at the bottom of the card", kept[0].relY > 0.9);

// ---- reading a modern two-line collector block ----
const modern = {
  frameWidth: 1080,
  frameHeight: 1920,
  lines: [
    lineAt("Llanowar Elves", g.left + 20, g.top + 20, g.left + 200, g.top + 34),
    lineAt("Creature — Elf Druid", g.left + 20, g.top + 200, g.left + 220, g.top + 214),
    // collector block, as ML Kit returns it: out of order
    inGuideBottom("FDN • EN", 1),
    inGuideBottom("0227 C", 0),
    lineAt("™ & © 2024 Wizards of the Coast", g.left + 150, g.bottom - 22, g.right - 10, g.bottom - 14),
  ],
};
const r1 = candidatesFromFrame(modern, view, g);
check("two-line collector block reads as FDN 0227", r1.candidates[0]?.set === "FDN" && r1.candidates[0]?.number === "0227");

const older = {
  frameWidth: 1080,
  frameHeight: 1920,
  lines: [inGuideBottom("245/264 U"), inGuideBottom("M20 • EN", 1)],
};
const r2 = candidatesFromFrame(older, view, g);
check("number/total style reads too", r2.candidates[0]?.set === "M20" && r2.candidates[0]?.number === "245");

const offGuide = {
  frameWidth: 1080,
  frameHeight: 1920,
  lines: [lineAt("DMU U 0123", 4, 8, 90, 18)],
};
check("a code outside the guide is still found when nothing inside reads", candidatesFromFrame(offGuide, view, g).candidates[0]?.set === "DMU");
check("a frame with no code yields nothing", candidatesFromFrame({ frameWidth: 1080, frameHeight: 1920, lines: [inGuideBottom("Illus. Some Artist")] }, view, g).candidates.length === 0);
check("an empty event is harmless", candidatesFromFrame({}, view, g).candidates.length === 0);

// ---- two frames must agree ----
const st = createStabilizer();
check("one frame is not enough", st.push({ set: "FDN", number: "0227" }, 1000) === null);
check("a different reading doesn't confirm the first", st.push({ set: "FDN", number: "0221" }, 1200) === null);
check("the same reading again confirms it", st.push({ set: "FDN", number: "0227" }, 1400)?.number === "0227");
const st2 = createStabilizer();
st2.push({ set: "FDN", number: "1" }, 0);
check("agreement has to be recent", st2.push({ set: "FDN", number: "1" }, 5000) === null);

// ---- the overlay, driven by a fake plugin ----
function fakePlugin({ failStart } = {}) {
  const p = {
    listeners: [],
    started: 0,
    stopped: 0,
    torch: null,
    focusedAt: null,
    async addListener(name, fn) {
      const entry = { name, fn, remove: () => (p.listeners = p.listeners.filter((l) => l !== entry)) };
      p.listeners.push(entry);
      return entry;
    },
    async start() {
      if (failStart) {
        const e = new Error("Camera permission was denied");
        e.code = "PERMISSION_DENIED";
        throw e;
      }
      p.started += 1;
    },
    async stop() {
      p.stopped += 1;
    },
    async setTorch({ enabled }) {
      p.torch = enabled;
    },
    async focus(pt) {
      p.focusedAt = pt;
    },
    emit(event) {
      p.listeners.filter((l) => l.name === "textRecognized").forEach((l) => l.fn(event));
    },
  };
  return p;
}
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, clientX: 195, clientY: 300 }));
  });
};

const offline = { resolve: async () => ({ status: "unverifiable" }) }; // no lookups in these tests
const plugin = fakePlugin();
const detections = [];
const holder = document.getElementById("root");
const root = createRoot(holder);
await act(async () => {
  root.render(React.createElement(ScanCardTab, { livePlugin: plugin, resolver: offline, onDetected: (s, n) => detections.push(`${s}#${n}`) }));
});
const openBtn = document.querySelector('[data-testid="live-scan-open"]');
check("the phone app shows the live scanner button instead of photo upload", !!openBtn && !document.querySelector('[data-testid="scan-file-input"]'));
await click(openBtn);
await act(async () => {
  await wait(20);
});
const overlay = document.querySelector('[data-testid="live-scan"]');
check("opening starts the camera", plugin.started === 1 && !!overlay);
check("the overlay sits outside #root (so it survives #root being hidden)", !!overlay && !holder.contains(overlay));
check("scanning makes the page see-through", document.documentElement.classList.contains("bw-scanning"));

await click(overlay);
check("tapping focuses there", plugin.focusedAt && Math.abs(plugin.focusedAt.x - 0.5) < 0.01);
const torchBtn = document.querySelector('[aria-label="Turn the light on"]');
await click(torchBtn);
check("the torch button switches the light on", plugin.torch === true);

await act(async () => {
  plugin.emit(modern);
});
check("one frame shows what it's reading, but doesn't commit", document.querySelector('[data-testid="live-scan-status"]')?.textContent.includes("FDN 0227") && detections.length === 0);
await act(async () => {
  plugin.emit(modern);
  await wait(10);
});
check("a second agreeing frame commits the code", detections.length === 1 && detections[0] === "FDN#0227");
check("…and closes the scanner", !document.querySelector('[data-testid="live-scan"]'));
check("…stopping the camera", plugin.stopped === 1);
check("…and making the page opaque again", !document.documentElement.classList.contains("bw-scanning"));
check("the tab says what it found", document.body.textContent.includes("Detected FDN #0227"));
await act(async () => {
  plugin.emit(modern);
});
check("frames after closing are ignored", detections.length === 1);
await act(async () => root.unmount());

// autoStart: the next card after an add goes straight to the camera
const plugin2 = fakePlugin();
const root2 = createRoot(holder);
await act(async () => {
  root2.render(React.createElement(ScanCardTab, { livePlugin: plugin2, resolver: offline, autoStart: true, onDetected: () => {} }));
  await wait(20);
});
check("autoStart reopens the camera for the next card", plugin2.started === 1 && !!document.querySelector('[data-testid="live-scan"]'));
await act(async () => {
  window.dispatchEvent(new Event("bw-scanner-back"));
  await wait(10);
});
check("Android back closes the scanner", !document.querySelector('[data-testid="live-scan"]') && plugin2.stopped === 1);
await act(async () => root2.unmount());

// permission denied
const plugin3 = fakePlugin({ failStart: true });
const root3 = createRoot(holder);
await act(async () => {
  root3.render(React.createElement(ScanCardTab, { livePlugin: plugin3, resolver: offline, autoStart: true, onDetected: () => {} }));
  await wait(20);
});
check("a denied camera explains how to turn it on", /Permissions/.test(document.querySelector('[data-testid="live-scan"]')?.textContent || ""));
check("…and doesn't leave the page see-through", !document.documentElement.classList.contains("bw-scanning"));
await act(async () => root3.unmount());

// ---- name across the top is read and compared with the code ----
check("the card name is read from the top of the guide", r1.names[0] === "Llanowar Elves");
check("the legal line is never mistaken for a set code", !candidatesFromFrame({ frameWidth: 1080, frameHeight: 1920, lines: [inGuideBottom("™ & © 2022 Wizards of the Coast TM 178")] }, view, g).candidates.some((c) => c.set === "TM"));
check("TM 178 is not a code", parseCollectorLine("TM 178").length === 0);
check("an exact name matches", nameMatches("Fallaji Excavation", "Fallaji Excavation"));
check("a letter or two of OCR noise still matches", nameMatches("Fallajl Excavatlon", "Fallaji Excavation"));
check("either face of a double-faced card matches", nameMatches("Delver of Secrets", "Delver of Secrets // Insectile Aberration"));
check("a different card does not match", !nameMatches("Llanowar Elves", "Fallaji Excavation"));
check("junk does not match", !nameMatches("3G", "Fallaji Excavation"));

const cards = { "BRO#178": { name: "Fallaji Excavation", set: "bro", collectorNumber: "178" } };
const fakeDb = createResolver({
  byCode: async (set, num) => cards[`${set}#${num}`] || Promise.reject(new Error(`No card ${num} in set ${set}`)),
  byName: async () => Promise.reject(new Error("Card not found")),
});
const broFrame = (name) => ({
  frameWidth: 1080,
  frameHeight: 1920,
  lines: [
    lineAt(name, g.left + 20, g.top + 20, g.left + 200, g.top + 34),
    inGuideBottom("178/287 U", 0),
    inGuideBottom("BRO • EN", 1),
    lineAt("™ & © 2022 Wizards of the Coast", g.left + 150, g.bottom - 22, g.right - 10, g.bottom - 14),
  ],
});
const rc = candidatesFromFrame(broFrame("Fallaji Excavation"), view, g);
check("the real card's code reads as BRO 178", rc.candidates[0]?.set === "BRO" && rc.candidates[0]?.number === "178");
check("name + code agree → confirmed", (await fakeDb.resolve(rc)).status === "confirmed");
check("a different name on the card → mismatch, not accepted", (await fakeDb.resolve({ ...rc, names: ["Llanowar Elves"] })).status === "mismatch");
check("a code that isn't a card → none", (await fakeDb.resolve({ candidates: [{ set: "TM", number: "178" }], names: ["Fallaji Excavation"] })).status === "none");
check("no name readable → code-only", (await fakeDb.resolve({ ...rc, names: [] })).status === "code-only");

const p4 = fakePlugin();
const d4 = [];
const root4 = createRoot(holder);
await act(async () => {
  root4.render(React.createElement(ScanCardTab, { livePlugin: p4, resolver: fakeDb, autoStart: true, onDetected: (s, n) => d4.push(`${s}#${n}`) }));
  await wait(20);
});
await act(async () => {
  p4.emit(broFrame("Llanowar Elves"));
  await wait(20);
});
check("a name that disagrees with the code is not taken", d4.length === 0 && !!document.querySelector('[data-testid="live-scan-use-anyway"]'));
await act(async () => {
  p4.emit(broFrame("Fallaji Excavation"));
  await wait(20);
});
check("name and code agreeing commits on ONE frame", d4.length === 1 && d4[0] === "BRO#178");
await act(async () => root4.unmount());

// ---- continuous: the camera stays open and cards pile up ----
const p5 = fakePlugin();
const got = [];
const root5 = createRoot(holder);
await act(async () => {
  root5.render(React.createElement(ScanCardTab, { livePlugin: p5, resolver: fakeDb, autoStart: true, onDetected: () => got.push("closed-path"), onScanned: (card, s2, n2) => got.push(`${card.name}|${s2}#${n2}`) }));
  await wait(20);
});
await act(async () => {
  p5.emit(broFrame("Fallaji Excavation"));
  await wait(20);
});
check("a confirmed card goes to onScanned", got.length === 1 && got[0] === "Fallaji Excavation|BRO#178");
check("…and the scanner stays open", !!document.querySelector('[data-testid="live-scan"]') && p5.stopped === 0);
check("…showing the card and a count", /Fallaji Excavation/.test(document.querySelector('[data-testid="live-scan-last"]')?.textContent || "") && /1 scanned/.test(document.querySelector('[data-testid="live-scan-count"]')?.textContent || ""));
await act(async () => {
  p5.emit(broFrame("Fallaji Excavation"));
  await wait(20);
  p5.emit(broFrame("Fallaji Excavation"));
  await wait(20);
});
check("holding the same card still doesn't count it twice", got.length === 1);
await wait(700);
await act(async () => {
  p5.emit({ frameWidth: 1080, frameHeight: 1920, lines: [lineAt("Fallaji Excavation", g.left + 20, g.top + 20, g.left + 200, g.top + 34)] });
  await wait(20);
});
await wait(700);
await act(async () => {
  p5.emit(broFrame("Fallaji Excavation"));
  await wait(20);
});
check("a blurry stretch (only the name readable) while holding the card doesn't re-add it", got.length === 1);
await wait(REPEAT_GAP_MS + 100);
await act(async () => {
  p5.emit(broFrame("Fallaji Excavation"));
  await wait(20);
});
check("after the card leaves and comes back it's a second copy", got.length === 2);
await click(document.querySelector('[data-testid="live-scan-plus"]'));
check("+1 adds another copy on purpose", got.length === 3 && /×2/.test(document.querySelector('[data-testid="live-scan-plus"]')?.textContent || ""));
await click(document.querySelector('[data-testid="live-scan-done"]'));
check("Done closes the scanner", !document.querySelector('[data-testid="live-scan"]') && p5.stopped === 1 && !got.includes("closed-path"));
await act(async () => root5.unmount());

// ---- Android back button routing ----
const doc = new JSDOM("<!doctype html><html><body></body></html>").window.document;
check("back with nothing open sends the app to the background", decideBack(doc) === "background");
doc.body.innerHTML = '<div data-role="modal-backdrop"></div>';
check("back with a dialog open closes it (Escape)", decideBack(doc) === "escape");
doc.body.innerHTML = '<div data-bw-back="life"></div>';
check("back in the Life Counter leaves it (Escape)", decideBack(doc) === "escape");
doc.documentElement.classList.add("bw-scanning");
check("back while scanning closes the scanner first", decideBack(doc) === "scanner");

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
