/*
 * Links and images that come out of a vault are whatever its owner's client
 * (or a hand-made request) put there. On a PUBLIC page they reach strangers, so
 * only Scryfall addresses survive: a `javascript:` link would run in the
 * visitor's signed-in session, and an image from anywhere else is a tracking
 * pixel that tells its owner who looked at the page.
 */

const PAGE = /^https:\/\/scryfall\.com\/[^\s"'<>]*$/i;
const IMAGE = /^https:\/\/(?:cards|c1|svgs)\.scryfall\.(?:io|com)\/[^\s"'<>]*$/i;

const safePageUrl = (u) => (typeof u === "string" && u.length < 600 && PAGE.test(u) ? u : null);
const safeImageUrl = (u) => (typeof u === "string" && u.length < 600 && IMAGE.test(u) ? u : null);

// Applies the right rule to a public card's fields, in place.
function cleanCardUrls(out) {
  for (const f of ["imageUrl", "imageUrlLarge", "imageUrlBack", "imageUrlBackLarge"]) if (f in out) out[f] = safeImageUrl(out[f]);
  if ("scryfallUri" in out) out.scryfallUri = safePageUrl(out.scryfallUri);
  return out;
}

module.exports = { safePageUrl, safeImageUrl, cleanCardUrls };
