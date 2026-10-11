// Tiny path router: each top-level tab (and an open deck) has a real URL, so
// the browser's back / forward buttons and reloads behave. "/" is the
// collection, so there is no /collection. The server's SPA fallback already
// serves index.html for these paths.
export const VIEW_PATHS = {
  collection: "/",
  sets: "/sets",
  decks: "/decks",
  wishlist: "/wishlist",
  glossary: "/glossary",
  playgroup: "/playgroup",
  life: "/life",
};

// "/decks/abc" -> { view: "decks", deckId: "abc" }. Unknown paths resolve
// to "notfound" (the 404 page).
export function parsePath(pathname) {
  const parts = String(pathname || "/").split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch (e) { return s; }
  });
  const first = (parts[0] || "").toLowerCase();
  if (first === "collection") return { view: "collection", deckId: null };
  const view = Object.keys(VIEW_PATHS).find((v) => v !== "collection" && v === first);
  if (!view) return { view: parts.length ? "notfound" : "collection", deckId: null };
  return { view, deckId: view === "decks" && parts[1] ? parts[1] : null };
}

export function pathFor(view, deckId = null) {
  const base = VIEW_PATHS[view] || "/";
  return view === "decks" && deckId ? `${base}/${encodeURIComponent(deckId)}` : base;
}
