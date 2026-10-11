// The thinking half of the phone app's live scanner. The native plugin
// (native/live-scanner) only reports what text it sees in each camera frame;
// everything here decides what that text MEANS, and is plain JS so it can be
// tested without a camera:
//
//   • which lines fall inside the on-screen card guide (the camera frame is
//     centre-cropped to fill the screen, so frame coordinates ≠ screen ones);
//   • which of those form the collector line — handed to the SAME parser the
//     web scanner uses (ocr.js), bottom-of-card lines first, then the whole
//     card, exactly like the Tesseract path's band/full-card fallback;
//   • when a reading is trustworthy: one frame can misread a digit, so a code
//     is only accepted once it has come back the same in two frames.

import { pickCandidates } from "./ocr";

// Card proportions (63 × 88 mm) — the on-screen guide is drawn to this.
export const CARD_RATIO = 63 / 88;

// Where a point of the camera frame (0..1 each way) lands on a screen of
// viewW × viewH CSS pixels, when the frame (frameW × frameH px, upright) is
// scaled to COVER the screen and centred — Android's PreviewView FILL_CENTER
// and iOS's resizeAspectFill both do exactly this.
export function frameToView(x, y, frame, view) {
  const scale = Math.max(view.w / frame.w, view.h / frame.h);
  const offX = (frame.w * scale - view.w) / 2;
  const offY = (frame.h * scale - view.h) / 2;
  return { x: x * frame.w * scale - offX, y: y * frame.h * scale - offY };
}

// The lines whose centre is inside `region` (screen px, {left, top, right,
// bottom}), grown by `slack` of its size on every side — the phone's preview
// and the analysed frame don't always line up to the pixel. Each line gets
// `relY`: where its centre sits down the region, 0 = top edge, 1 = bottom.
export function linesInRegion(lines, frame, view, region, slack = 0.08) {
  const w = region.right - region.left;
  const h = region.bottom - region.top;
  const box = {
    left: region.left - w * slack,
    right: region.right + w * slack,
    top: region.top - h * slack,
    bottom: region.bottom + h * slack,
  };
  const out = [];
  for (const l of lines || []) {
    if (!l || typeof l.text !== "string") continue;
    const c = frameToView((l.left + l.right) / 2, (l.top + l.bottom) / 2, frame, view);
    if (c.x < box.left || c.x > box.right || c.y < box.top || c.y > box.bottom) continue;
    out.push({ ...l, relY: (c.y - region.top) / h, relX: (c.x - region.left) / w });
  }
  return out;
}

// Reading order: top to bottom, and left to right within roughly one row.
// The collector line is often two lines on the card ("0245 U" over
// "FDN • EN"), and the parser expects them in that order, joined.
function readingOrder(lines) {
  return [...lines].sort((a, b) => {
    const dy = a.top - b.top;
    const rowH = Math.max(a.bottom - a.top, b.bottom - b.top, 0.001);
    if (Math.abs(dy) > rowH * 0.6) return dy;
    return a.left - b.left;
  });
}

// Lines from the bottom strip of the card count as the "band" (the fast,
// usually-right read); everything inside the guide is the "full card" pass.
// If nothing inside the guide reads as a code, the whole frame gets a look —
// a card held a little off the guide still scans.
export const BAND_FROM = 0.78;

// Lines that can never be part of the collector code or the card name: the
// legal line ("™ & © 2022 Wizards of the Coast") sits right beside the code and
// its "TM" used to be read as a set code, and "Illus." is the artist credit.
const NOISE_LINE = /[©™]|wizards|coast|\billus\b|\bllc\b/i;

// The card's name: the first readable line(s) across the top of the guide.
// Returns alternatives (each line alone, and two joined) for the comparison.
export const NAME_BAND_TO = 0.17;
export function nameCandidates(inside) {
  const top = readingOrder(
    inside.filter((l) => l.relY !== undefined && l.relY <= NAME_BAND_TO && !NOISE_LINE.test(l.text))
  )
    .map((l) => l.text.replace(/[^\p{L}'’,\- ]+/gu, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t.replace(/[^\p{L}]/gu, "").length >= 3)
    .slice(0, 2);
  return top.length === 2 ? [...top, `${top[0]} ${top[1]}`] : top;
}

export function candidatesFromFrame(event, view, region) {
  const frame = { w: event?.frameWidth || 1, h: event?.frameHeight || 1 };
  const all = (event?.lines || []).filter((l) => l && typeof l.text === "string" && !NOISE_LINE.test(l.text));
  const inside = region ? linesInRegion(all, frame, view, region) : all;
  const band = inside.filter((l) => l.relY === undefined || l.relY >= BAND_FROM);
  const text = (ls) => readingOrder(ls).map((l) => l.text).join("\n");
  const names = nameCandidates(inside);
  const first = pickCandidates(text(band), text(inside));
  if (first.candidates.length > 0 || !region) {
    return { candidates: first.candidates, text: text(inside), names };
  }
  const wide = pickCandidates("", text(all));
  return { candidates: wide.candidates, text: text(all), names };
}

// Two agreeing frames within `windowMs` make a reading. Anything seen only
// once — a digit misread as the camera refocuses, a glimpse of the next card
// in the stack — never gets through.
export function createStabilizer({ need = 2, windowMs = 1500 } = {}) {
  let seen = [];
  return {
    push(candidate, now = Date.now()) {
      seen = seen.filter((s) => now - s.at <= windowMs);
      if (!candidate) return null;
      const key = `${candidate.set}#${candidate.number}`;
      seen.push({ key, at: now });
      const count = seen.filter((s) => s.key === key).length;
      return count >= need ? candidate : null;
    },
    reset() {
      seen = [];
    },
  };
}

// The on-screen guide: a card-shaped box, as large as fits with room for the
// top bar and bottom panel. Shared by the overlay (to draw it) and the
// recognition (to know what's inside it), so the two can't disagree.
export function guideRect(viewW, viewH, { top = 72, bottom = 150, side = 20 } = {}) {
  const availW = Math.max(viewW - side * 2, 100);
  const availH = Math.max(viewH - top - bottom, 140);
  let w = availW;
  let h = w / CARD_RATIO;
  if (h > availH) {
    h = availH;
    w = h * CARD_RATIO;
  }
  const left = (viewW - w) / 2;
  const topPx = top + (availH - h) / 2;
  return { left, top: topPx, right: left + w, bottom: topPx + h, width: w, height: h };
}
