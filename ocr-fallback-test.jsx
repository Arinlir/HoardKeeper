// Regression test for: "the scan feature isn't reading the numbers - it
// should scan the entire card rather than just code." The scanner used to
// OCR only a fixed bottom-band crop of the photo (where the collector
// number/set code usually sits); if that crop missed it — glare, an
// unusual frame, a crooked photo — there was no second attempt. Now a full
// pass over the whole card runs as a fallback when the band comes up empty.
//
// No real camera, canvas, or Tesseract needed: pickCandidates is a pure
// function (covered directly), and the two geometry functions only touch
// document.createElement("canvas") and a 2D context, which jsdom doesn't
// implement — a minimal fake canvas/context stands in for both, recording
// just enough (final width/height, whether grayscale ran) to check the
// geometry without a real rendering engine. The end-to-end retry inside
// recognizeCollectorLine() itself needs a real Tesseract worker, which is
// out of scope for this harness the same way scan-tab-test.jsx already
// treats camera/OCR integration as a real-browser Playwright concern.
import { cropToBottomBand, pickCandidates, prepareFullCard } from "./src/lib/ocr.js";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

// ---- pickCandidates: band wins if it has anything, full is the fallback --
check(
  "a band hit is used even when the full text also has something",
  pickCandidates("245/264 U FDN EN", "9/281 MH3").candidates[0]?.set === "FDN"
);
check("a band miss falls through to the full-card text", pickCandidates("", "9/281 MH3").candidates[0]?.set === "MH3");
check(
  "a noisy full-card OCR (name + rules text around the real line) still resolves",
  pickCandidates("", "Ashcinder Wyrm\nLegendary Creature — Dragon\n\n245/264 U FDN EN\nArtist Name 2024").candidates[0]
    ?.set === "FDN"
);
check("both empty stays empty, doesn't throw", pickCandidates("", "").candidates.length === 0);
check("pickCandidates reports which source actually resolved it", pickCandidates("", "9/281 MH3").usedFull === true);
check("...and reports band when the band resolved it", pickCandidates("245/264 U FDN EN", "").usedFull === false);

// ---- geometry: fake canvas/context, no real rendering needed -------------
class FakeCtx {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.grayscaleRan = false;
  }
  getImageData(x, y, w, h) {
    // mid-gray, opaque — enough for the grayscale/contrast math to run
    // without dividing by zero (a flat image has max === min).
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 128;
      data[i + 3] = 255;
    }
    return { data };
  }
  putImageData() {
    this.grayscaleRan = true;
  }
  drawImage() {}
}
class FakeCanvas {
  getContext(type) {
    if (type !== "2d") return null;
    this._ctx = new FakeCtx(this.width, this.height);
    return this._ctx;
  }
}
globalThis.document = {
  createElement(tag) {
    if (tag !== "canvas") throw new Error(`unexpected createElement("${tag}") in ocr geometry`);
    return new FakeCanvas();
  },
};

function fakeSource(w, h) {
  return { width: w, height: h };
}

// A big phone photo, portrait card shape.
const bigSource = fakeSource(3024, 4032);
const band = cropToBottomBand(bigSource);
check("the band crop is roughly 16% of the source height (scaled)", Math.abs(band.height / band.width - (bigSource.height * 0.16) / bigSource.width) < 0.01);
check("the band is grayscaled/contrast-stretched", band._ctx.grayscaleRan);

const full = prepareFullCard(bigSource);
check("the full-card pass keeps the full card's aspect ratio, not just a band", Math.abs(full.height / full.width - bigSource.height / bigSource.width) < 0.01);
check("a large source photo is scaled DOWN for the full-card pass, not blown up further", full.width < bigSource.width);
check("the full-card width is capped at the 1600px target", full.width <= 1600);
check("the full card is grayscaled/contrast-stretched too", full._ctx.grayscaleRan);

// A small/low-res source shouldn't get blown up by the full-card pass —
// only the band crop upscales (a thin strip benefits from it; a whole photo
// doesn't need to).
const smallSource = fakeSource(400, 560);
const smallFull = prepareFullCard(smallSource);
check("a small source is left at its own size for the full-card pass, never upscaled", smallFull.width === smallSource.width && smallFull.height === smallSource.height);
const smallBand = cropToBottomBand(smallSource);
check("the band crop DOES upscale a small source (it's the one that needs it)", smallBand.width > smallSource.width);

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
