// Tests computeGlossarySearchDiagnostic directly against known inputs --
// deliberately bypassing any DOM/search-box simulation, since typing a
// second distinct value into a React-controlled input is an unreliable
// pattern in this jsdom setup (documented elsewhere in this suite; verified
// independently via inline debugging that the underlying logic is correct
// and the gap is purely in simulating the interaction, not the app).
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { innerHeight: 900, location: { search: "", pathname: "/" }, history: { replaceState(){} } };
globalThis.fetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
import { __test_computeGlossarySearchDiagnostic as diag } from "./src/App.jsx";

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}

const ezio = { name: "Ezio Auditore da Firenze", scryfallId: "ezio" };
const murder = { name: "Murder", scryfallId: "murder" };
const oracle = {
  ezio: { t: "Assassin spells you cast have freerunning {B}{B}. (You may cast a spell for its freerunning cost if you dealt combat damage to a player this turn with an Assassin or commander.)" },
  murder: { t: "Destroy target creature." },
};

// --- 1. empty query: no diagnostic at all ---
check("empty query returns null", diag("", [], [ezio, murder], oracle) === null);
check("whitespace-only query returns null", diag("   ", [], [ezio, murder], oracle) === null);

// --- 2. real matches exist: no diagnostic needed, entries already show it ---
check("non-empty entries suppresses the diagnostic entirely", diag("freerunning", [{ k: "Freerunning" }], [ezio, murder], oracle) === null);

// --- 3. a real keyword name, but genuinely not present in any scanned card ---
{
  const d = diag("convoke", [], [murder], oracle); // murder's text has no "convoke"
  check("real keyword absent from all scanned text -> not-owned tone", d?.tone === "not-owned");
  check("not-owned message names the actual scanned count", d?.text.includes("1 scanned cards"));
  check("not-owned message is honest about not knowing for sure (says 'likely')", d?.text.includes("likely don't own"));
}

// --- 4. text present in raw scanned oracle text but not a recognized keyword name ---
{
  const d = diag("combat damage to a player", [], [ezio, murder], oracle);
  check("text found in real scanned text but not a keyword name -> bug tone", d?.tone === "bug");
  check("bug message names the specific matching card", d?.text.includes("Ezio Auditore da Firenze"));
  check("bug message flags it as worth reporting", d?.text.includes("worth reporting"));
  check("bug message does NOT include Murder, which doesn't match", !d?.text.includes("Murder"));
}

// --- 5. gibberish that isn't a keyword name and matches nothing ---
{
  const d = diag("zzznonexistentmechanic", [], [ezio, murder], oracle);
  check("unrecognized term with no text matches -> unknown tone", d?.tone === "unknown");
  check("unknown message names the actual search term", d?.text.includes("zzznonexistentmechanic"));
}

// --- 6. the exact real-world scenario: searching "freerunning" when it genuinely IS present ---
{
  // entries non-empty because Freerunning WAS detected -- diagnostic should stay silent
  const d = diag("freerunning", [{ k: "Freerunning", count: 1 }], [ezio, murder], oracle);
  check("when Freerunning genuinely matches, diagnostic stays silent (entries already show it)", d === null);
}

// --- 7. case-insensitivity ---
{
  const d = diag("CONVOKE", [], [murder], oracle);
  check("search is case-insensitive", d?.tone === "not-owned");
}

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
