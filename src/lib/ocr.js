// Client-side card scanning: OCR the collector-number/set-code line printed
// along a card's bottom edge (e.g. "245/264 U FDN EN" or the older
// "FDN U 0125" style) rather than the stylized card-name text — the plain
// mono-ish font there is far more OCR-reliable, and it's exactly what the
// app's existing "By code" lookup (scryfallByCode) already needs.
//
// Everything here that touches the DOM/canvas/network is browser-only and
// loaded lazily (dynamic import of tesseract.js) so it never sits in the
// main bundle for people who never open the Scan tab. parseCollectorLine()
// is the one pure function, deliberately kept dependency-free so it can be
// unit-tested under jsdom without a real camera, canvas, or OCR engine.

// --- parsing -----------------------------------------------------------

// A "set code" here is 2-5 letters — Scryfall set codes are almost always
// 3-5, but a couple of very old sets are 2 (e.g. "LE"), so 2 is the floor.
// Single-letter rarity codes (C/U/R/M/S/T/B/P) are treated as noise to skip
// over, not as candidate set codes, since [A-Z]{2,5} already excludes them.
const RARITY = "CURMSTBP";

// Set codes are 2-5 chars but not always pure letters — several real sets
// mix in digits (MH1/MH2/MH3, 2XM, 40K, 30A...) — so the class allows both,
// gated by a lookahead requiring at least one actual letter so a bare
// number is never mistaken for a set code.
const SET = "(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,5}";

const PATTERNS = [
  // "245/264 U FDN EN" — modern full collector line, number-first with a
  // total, then an optional single rarity letter, then the set code.
  { re: new RegExp(`(\\d{1,4})\\s{0,3}\\/\\s{0,3}\\d{1,4}\\s*(?:[${RARITY}]\\s+)?(${SET})\\b`, "g"), order: "num-set" },
  // "FDN U 0125" / "FDN-U-0125" — pre-2019 style, set code first.
  { re: new RegExp(`\\b(${SET})[\\s\\-•.]{1,3}[${RARITY}][\\s\\-•.]{1,3}(\\d{1,4}[A-Z]?)\\b`, "g"), order: "set-num" },
  // "0125 U FDN" — the same triple, reversed.
  { re: new RegExp(`\\b(\\d{1,4}[A-Z]?)[\\s\\-•.]{1,3}[${RARITY}][\\s\\-•.]{0,3}(${SET})\\b`, "g"), order: "num-set" },
  // no rarity letter recognized between them — loosest, tried last.
  { re: new RegExp(`\\b(${SET})[\\s\\-•.]{1,3}(\\d{1,4}[A-Z]?)\\b`, "g"), order: "set-num" },
  { re: new RegExp(`\\b(\\d{1,4}[A-Z]?)[\\s\\-•.]{1,3}(${SET})\\b`, "g"), order: "num-set" },
];

// Words that legitimately look like a set code but never are one — the
// language tag on the same line is the main offender ("EN", "DE", "JP"...).
// "TM" is the ™ of the "™ & © Wizards of the Coast" line, and the rest are its neighbours.
const NOT_A_SET = new Set(["TM", "WOTC", "LLC", "INC", "USA", "EN", "DE", "FR", "IT", "ES", "PT", "JA", "JP", "KO", "RU", "ZH", "CN", "CS"]);

function toCandidate(m, order) {
  const [, a, b] = m;
  const [set, number] = order === "set-num" ? [a, b] : [b, a];
  const setUp = set.toUpperCase();
  if (NOT_A_SET.has(setUp)) return null;
  return { set: setUp, number: number.toUpperCase() };
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = `${c.set}#${c.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Returns candidates ordered best-guess-first. Never throws — worst case is
// an empty array, which the caller shows as "couldn't read it, enter it
// manually" rather than an error.
export function parseCollectorLine(rawText) {
  const text = String(rawText || "")
    .toUpperCase()
    .replace(/[|]/g, "I") // common OCR confusion, harmless outside numbers
    .replace(/\s+/g, " ");

  const found = [];
  for (const { re, order } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const c = toCandidate(m, order);
      if (c) found.push(c);
    }
  }
  return dedupe(found);
}

// --- image capture / preprocessing (browser only) -----------------------

// Grayscale + a simple contrast stretch, applied in place on whatever's
// already drawn into ctx — the collector line (and, for the full-card pass
// below, everything else printed on the card) is plain small text on a flat
// background, so this alone goes a long way for either. Shared by both
// preprocessing paths so they stay in sync rather than drifting apart.
function applyGrayscaleContrast(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let min = 255;
  let max = 0;
  const gray = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(max - min, 1);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = ((gray[j] - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

// Crops to the bottom band of the card (where the collector line sits) and
// upscales it — a thin, enlarged, high-contrast strip OCRs far more
// reliably than running Tesseract over the whole photo, and it's the fast,
// usually-right first attempt (see recognizeCollectorLine below).
export function cropToBottomBand(sourceCanvas) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const bandH = Math.round(sh * 0.16);
  const bandY = sh - bandH;

  // Target a fixed working width regardless of the source photo's actual
  // resolution. A modern phone camera shoots 3000-4000px+ wide, and a flat
  // 3x multiplier on top of that produces a many-megapixel canvas that can
  // silently exceed mobile Safari's canvas size limit — getImageData then
  // either throws or (worse) just returns nothing, with no visible error —
  // and it's pure waste anyway: a single line of text OCRs fine at ~1400px.
  // A low-res source still gets scaled *up* toward the target, capped so a
  // tiny image isn't blown up into mush.
  const TARGET_W = 1400;
  const scale = Math.max(1, Math.min(4, TARGET_W / sw));

  const out = document.createElement("canvas");
  out.width = Math.round(sw * scale);
  out.height = Math.round(bandH * scale);
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, 0, bandY, sw, bandH, 0, 0, out.width, out.height);
  applyGrayscaleContrast(ctx, out.width, out.height);
  return out;
}

// The whole card, grayscaled and contrast-stretched but *not* cropped —
// the fallback for when the bottom-band guess above comes up empty (glare
// right on the collector line, a frame that puts it somewhere other than
// the usual bottom strip, a crooked photo that put the wrong pixels in the
// band). Unlike the band, this never needs upscaling — a full phone photo
// is already sharp enough — so it's only ever scaled down, and only enough
// to keep Tesseract from chewing on a many-megapixel image for no benefit.
export function prepareFullCard(sourceCanvas) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const TARGET_W = 1600;
  const scale = Math.min(1, TARGET_W / sw);

  const out = document.createElement("canvas");
  out.width = Math.round(sw * scale);
  out.height = Math.round(sh * scale);
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, 0, 0, sw, sh, 0, 0, out.width, out.height);
  applyGrayscaleContrast(ctx, out.width, out.height);
  return out;
}

// Prefers whatever the band found; only looks at the full-card text if the
// band came up empty. Kept as a pure function, separate from the actual OCR
// calls, so the fallback decision itself is unit-testable without a real
// OCR engine or a camera.
export function pickCandidates(bandText, fullText) {
  const bandCandidates = parseCollectorLine(bandText);
  if (bandCandidates.length > 0) return { candidates: bandCandidates, usedFull: false };
  return { candidates: parseCollectorLine(fullText), usedFull: true };
}

// Draws any image-like source (HTMLVideoElement, HTMLImageElement,
// ImageBitmap) onto a plain canvas at its natural pixel size.
export function sourceToCanvas(source, naturalWidth, naturalHeight) {
  const canvas = document.createElement("canvas");
  canvas.width = naturalWidth;
  canvas.height = naturalHeight;
  canvas.getContext("2d").drawImage(source, 0, 0, naturalWidth, naturalHeight);
  return canvas;
}

let workerPromise = null;

// A fetch failure deep inside the worker thread (no route to the langPath
// CDN, say) doesn't reliably surface as a rejection on the promises
// tesseract.js hands back on every version/environment — worst case it just
// never resolves. Every entry point below is wrapped in this so a bad
// network on the very first scan produces a clear, bounded error instead of
// an infinite "Reading the collector number…" spinner.
const OCR_TIMEOUT_MS = 45000;
function withTimeout(promise, message) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(message)), OCR_TIMEOUT_MS);
    }),
  ]);
}

// One worker, created lazily on first scan and reused for the rest of the
// session (spinning one up costs real time — no reason to pay it per shot).
// On any failure the worker is dropped so the next attempt starts clean
// instead of reusing something that may be wedged mid-load.
async function getWorker() {
  if (!workerPromise) {
    workerPromise = withTimeout(
      (async () => {
        const { createWorker } = await import("tesseract.js");
        const base = import.meta.env.BASE_URL || "./";
        // Must be absolute: these paths get resolved again from inside a
        // worker/wasm-loader context where a relative URL doesn't reliably
        // resolve against the page's location the way it does in a normal
        // <script>/fetch — a relative corePath fails there with a "Failed
        // to parse URL" error instead of quietly working.
        const abs = (p) => new URL(p, window.location.href).href;
        const worker = await createWorker("eng", 1, {
          workerPath: abs(`${base}tesseract/worker.min.js`),
          corePath: abs(`${base}tesseract/tesseract-core-simd.js`),
          // tesseract.js defaults to spawning the worker from a Blob URL
          // (`importScripts("<workerPath>")` inside a blob: worker) so it
          // can work with a CDN workerPath under a different origin than
          // the page. That indirection breaks *our* local, same-origin
          // setup: a blob: URL isn't a valid base for the core loader's own
          // relative `new URL(".", self.location.href)` lookup of the
          // sibling .wasm file, so it silently resolves to "" and the wasm
          // fetch fails with a bare filename. Spawning the worker directly
          // from workerPath keeps self.location.href a real, resolvable
          // local URL.
          workerBlobURL: false,
          // langPath intentionally left at its default (tesseract.js's
          // CDN) — the English model isn't bundled with the app, so the
          // very first scan needs a network connection to fetch it once;
          // it's then cached by the browser for every scan after that, on
          // or offline.
        });
        // The page-segmentation mode is set per call below (band vs. full
        // card need different ones) — only the whitelist is fixed for the
        // life of the worker.
        await worker.setParameters({
          tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/-• .",
        });
        return worker;
      })(),
      "Timed out starting the OCR engine — the first scan needs a network connection to fetch its language file. Check your connection and try again."
    ).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

async function runRecognize(worker, canvas, pageSegMode, timeoutMessage) {
  await worker.setParameters({ tessedit_pageseg_mode: pageSegMode });
  const { data } = await withTimeout(worker.recognize(canvas), timeoutMessage).catch((e) => {
    workerPromise = null;
    throw e;
  });
  return data?.text || "";
}

// Runs the full pipeline on a captured photo (an HTMLCanvasElement holding
// the whole card) and returns { text, candidates }. Throws only on a real
// failure to load/run the OCR engine (network down on first-ever scan,
// etc.) — a clean "nothing recognized" is a resolved result, not a throw.
//
// Two-stage: the bottom-band crop is fast and usually right, so it goes
// first (page-segmentation mode 7, "single text line" — exactly what a
// tight crop of just the collector line is). Only when that comes up empty
// does the whole card get a look, at mode 11 ("sparse text", suited to
// picking scattered tokens out of a page with no assumed reading order —
// name, mana cost, rules text and the collector line are all over the
// place relative to each other). Scanning the whole photo is the fallback
// rather than the default because it's both slower and noisier: a card's
// name and rules text sit outside the OCR whitelist and just cost accuracy
// on the one line that actually matters, when the band crop already had it.
// onStage, if given, is called with "full" right before the second pass
// starts, so a caller can show "checking the whole card…" instead of
// leaving the first message up while a second, slower pass runs unannounced.
export async function recognizeCollectorLine(fullCardCanvas, onStage) {
  const worker = await getWorker();

  const band = cropToBottomBand(fullCardCanvas);
  const bandText = await runRecognize(
    worker,
    band,
    "7",
    "OCR timed out reading that photo — try again, or enter the code by hand below."
  );
  const bandCandidates = parseCollectorLine(bandText);
  if (bandCandidates.length > 0) {
    return { text: bandText.trim(), candidates: bandCandidates };
  }

  onStage?.("full");
  const full = prepareFullCard(fullCardCanvas);
  const fullText = await runRecognize(
    worker,
    full,
    "11",
    "OCR timed out reading that photo — try again, or enter the code by hand below."
  );
  const { candidates } = pickCandidates(bandText, fullText);
  const combinedText = [bandText, fullText].filter(Boolean).join("\n").trim();
  return { text: combinedText, candidates };
}
