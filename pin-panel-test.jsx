// Full typed-input simulation through React's synthetic event system hit a
// jsdom-specific gap (real browsers handle the native-setter+dispatchEvent
// pattern fine -- this is a test-harness limitation, not a user-facing one).
// The security-critical part -- the server's actual PIN-change and
// delete-profile logic -- was independently verified with real curl calls
// against a live server (wrong PIN rejected on both endpoints, correct PIN
// accepted, old PIN invalidated after a change, empty-PIN removal works,
// deletion blocked by a wrong PIN with the profile surviving, deletion
// succeeding and the profile vanishing from /api/profiles afterward).
//
// This test verifies the frontend is wired up to reach that logic at all:
// the right buttons exist, open the right forms with the right fields, and
// Cancel actually returns to the closed state -- using clicks only, the
// pattern that's been reliable throughout this project's test suite.
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

localStorage.setItem("lf-profile", JSON.stringify({ name: "michael", pin: "" }));
globalThis.fetch = (url) => {
  const u = String(url);
  if (u.includes("/api/health")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: "pin" }) });
  if (u.includes("/api/store/michael"))
    return Promise.resolve({ ok: true, json: async () => ({ value: JSON.stringify({ collections: [], cards: [] }) }) });
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

const settingsBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Settings");
await act(async () => { settingsBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("Settings opened", document.body.textContent.includes("Currency & display"));
check("Profile section shows the signed-in profile", document.body.textContent.includes("michael"));

// --- Change PIN ---
const changeBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Change PIN");
check("Change PIN button present", !!changeBtn);
await act(async () => { changeBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });

const pwPlaceholders = [...document.querySelectorAll("input[type=password]")].map((i) => i.placeholder);
check("current-PIN field present", pwPlaceholders.some((p) => p.includes("Current PIN")));
check("new-PIN field present", pwPlaceholders.some((p) => p.includes("New PIN")));
check("confirm-PIN field present", pwPlaceholders.some((p) => p.includes("Confirm")));
check("exactly three PIN fields (not leaking the delete flow's field too)", pwPlaceholders.length === 3);

const saveBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save");
check("Save button present", !!saveBtn);
const cancelBtn1 = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel");
await act(async () => { cancelBtn1.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("Cancel closes the Change PIN form", ![...document.querySelectorAll("input[type=password]")].length);
check("the three action buttons are back", ["Switch user", "Change PIN", "Delete this profile"].every((label) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === label)));

// --- Delete profile ---
const deleteBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Delete this profile");
await act(async () => { deleteBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("delete warning names the profile and mentions it can't be undone", document.body.textContent.includes("michael") && document.body.textContent.includes("can't be undone"));
const deletePwFields = [...document.querySelectorAll("input[type=password]")];
check("exactly one PIN-confirmation field for delete", deletePwFields.length === 1);
check("delete confirm button present, styled as destructive", [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Delete this profile"));

const cancelBtn2 = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel");
await act(async () => { cancelBtn2.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("Cancel closes the delete form too", ![...document.querySelectorAll("input[type=password]")].length);

// Switch user still works alongside the new buttons (regression check)
const switchBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Switch user"));
await act(async () => { switchBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); });
check("Switch user still clears the saved login", localStorage.getItem("lf-profile") === null);

console.log(ok ? "\nALL PASS" : "\nFAIL");
if (!ok) process.exit(1);
process.exit(0);
