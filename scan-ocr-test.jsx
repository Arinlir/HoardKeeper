// parseCollectorLine is the one pure, dependency-free piece of the scan
// feature (lib/ocr.js) -- no camera, canvas, or actual OCR engine needed to
// verify its logic, just realistic strings a real OCR pass would produce.
import { parseCollectorLine } from "./src/lib/ocr.js";

let ok = true;
function check(label, cond) {
  console.log((cond ? "PASS" : "FAIL"), label);
  if (!cond) ok = false;
}
function top(text) {
  const c = parseCollectorLine(text);
  return c[0] || null;
}
function has(text, set, number) {
  return parseCollectorLine(text).some((c) => c.set === set && c.number === number);
}

// modern slash format
check("modern slash format: '245/264 U FDN EN'", has("245/264 U FDN EN", "FDN", "245"));
check("modern slash format, lowercase input", has("245/264 u fdn en", "FDN", "245"));
check("modern slash format, no rarity letter: '9/281 MH3'", has("9/281 MH3", "MH3", "9"));
check("language code not mistaken for the set: top candidate isn't EN", top("245/264 U FDN EN")?.set !== "EN");

// pre-2019 set-first triple, dash or space separated
check("classic dash format: 'FDN-U-0125'", has("FDN-U-0125", "FDN", "0125"));
check("classic space format (mtgscan reference example): 'FDN U 0125'", has("FDN U 0125", "FDN", "0125"));

// reversed order
check("number-first triple: '0125 U FDN'", has("0125 U FDN", "FDN", "0125"));

// noisy multi-line OCR output — the real line is buried among junk
const noisy = `Ashcinder Wyrm\nLegendary Creature — Dragon\n\n245/264 U FDN EN\nArtist Name 2024`;
check("noisy multi-line text still finds the real line", has(noisy, "FDN", "245"));

// no plausible line at all
check("garbage input yields no candidates", parseCollectorLine("just some random words here").length === 0);
check("empty input yields no candidates, doesn't throw", parseCollectorLine("").length === 0);
check("null/undefined input doesn't throw", parseCollectorLine(undefined).length === 0);

// special/promo printing with a trailing letter on the collector number
check("trailing-letter collector number: 'FDN M 150A'", has("FDN M 150A", "FDN", "150A"));

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
