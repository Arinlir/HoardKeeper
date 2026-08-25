import React, { useState, useEffect, useMemo, useRef } from "react";
import { Copy, Download, Layers, LibraryBig, Loader2, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import { IconButton } from "../../components/ui/IconButton";
import { downloadFile } from "../../lib/downloads";
import { fmt } from "../../lib/format";
import { MANA } from "../../lib/mana";
import { UNCATEGORIZED, fetchOracleTexts, fetchTokenCards, finishOf } from "../../lib/scryfall";
import { store, uid } from "../../lib/store";
import { C, STOCK_BG, STOCK_SHADOW } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";
import { DeckGallery } from "./DeckGallery";
import { ImportDeckModal } from "./ImportDeckModal";
import { TokensPanel } from "./TokensPanel";
import { deckToJson, deckToText } from "./deckIO";
import { ROLE_LABELS, ROLE_ORDER, ROLE_TARGETS, allowsAnyNumber, classifyRole, draftDeck, draftDeck60, identityFits, isBasicLand } from "./draftLogic";

export function DecksView({ cards, decks, setDecks, valueOf, collections }) {
  const collectionLabel = (id) => {
    if (!id || id === UNCATEGORIZED) return "Uncategorized";
    return collections?.find((c) => c.id === id)?.name || "Uncategorized";
  };
  const [openDeck, setOpenDeck] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [justAdded, setJustAdded] = useState("");
  const addInputRef = useRef(null);
  const [deckView, setDeckView] = useState("cards"); // cards | roles
  const [oracleMap, setOracleMap] = useState({});
  const [tokenCards, setTokenCards] = useState({});

  const commanders = useMemo(
    () =>
      cards.filter(
        (c) =>
          !c.sold &&
          (c.typeLine || "").includes("Legendary") &&
          (c.typeLine || "").includes("Creature")
      ),
    [cards]
  );

  const deck = decks.find((d) => d.id === openDeck) || null;

  // A physical card can only sit in one deck at a time. Work out how many
  // copies of each card the *other* decks have already claimed.
  // NOTE: must stay above the early return below — hooks can't be conditional.
  const committedElsewhere = useMemo(() => {
    const m = {};
    decks.forEach((d) => {
      if (d.id === openDeck) return;
      d.entries.forEach((e) => {
        m[e.cardId] = (m[e.cardId] || 0) + (e.qty || 1);
      });
      // another deck's commander is a physical card too
      if (d.commanderId) m[d.commanderId] = (m[d.commanderId] || 0) + 1;
    });
    return m;
  }, [decks, openDeck]);
  const commander = deck ? cards.find((c) => c.id === deck.commanderId) : null;
  const cardById = useMemo(() => {
    const m = {};
    cards.forEach((c) => (m[c.id] = c));
    return m;
  }, [cards]);

  const [newColors, setNewColors] = useState([]);
  const [importing, setImporting] = useState(false);

  // Which tokens this deck can make, and which cards make them. Derived from
  // Scryfall's related-card data rather than guessed from rules text.
  const tokensNeeded = useMemo(() => {
    if (!deck) return [];
    const members = [
      ...(commander ? [commander] : []),
      ...deck.entries.map((e) => cardById[e.cardId]).filter(Boolean),
    ];
    const byId = {};
    members.forEach((c) => {
      (oracleMap[c.scryfallId]?.parts || []).forEach((p) => {
        if (!byId[p.id]) byId[p.id] = { ...p, sources: [] };
        if (!byId[p.id].sources.includes(c.name)) byId[p.id].sources.push(c.name);
      });
    });
    // tokens added by hand sit alongside the detected ones
    (deck.extraTokens || []).forEach((t) => {
      if (!byId[t.id]) byId[t.id] = { ...t, sources: [], manual: true };
      else byId[t.id].manual = true;
    });
    return Object.values(byId).sort(
      (a, b) => b.sources.length - a.sources.length || a.name.localeCompare(b.name)
    );
  }, [deck, commander, cardById, oracleMap]);

  // artwork for those tokens
  useEffect(() => {
    const ids = tokensNeeded.map((t) => t.id).filter((id) => id && !tokenCards[id]);
    if (ids.length === 0) return;
    let live = true;
    (async () => {
      const map = await fetchTokenCards(ids);
      if (live) setTokenCards(map);
    })();
    return () => {
      live = false;
    };
  }, [tokensNeeded]);

  // rules text for the browse view, cached in the same store the drafter uses
  useEffect(() => {
    if (!deck) return;
    let live = true;
    const ids = [
      ...(commander?.scryfallId ? [commander.scryfallId] : []),
      ...deck.entries.map((e) => cardById[e.cardId]?.scryfallId).filter(Boolean),
    ];
    if (ids.length === 0) return;
    (async () => {
      const map = await fetchOracleTexts(ids);
      if (live) setOracleMap(map);
    })();
    return () => { live = false; };
  }, [openDeck, deck?.entries?.length]);

  function createDeck(commanderId) {
    const cmd = cards.find((c) => c.id === commanderId);
    if (!cmd) return;
    const id = uid();
    setDecks((prev) => [
      ...prev,
      { id, format: "commander", name: `${cmd.name.split(",")[0]} deck`, commanderId, entries: [], basics: {} },
    ]);
    setOpenDeck(id);
  }

  function createDeck60() {
    if (newColors.length === 0) return;
    const id = uid();
    setDecks((prev) => [
      ...prev,
      { id, format: "standard", name: `${newColors.join("")} 60-card deck`, colors: [...newColors], entries: [], basics: {} },
    ]);
    setNewColors([]);
    setOpenDeck(id);
  }

  // Cards committed to every deck, so an import can't claim a copy that's
  // already sleeved somewhere else.
  const committedAll = useMemo(() => {
    const m = {};
    decks.forEach((d) => {
      d.entries.forEach((e) => {
        m[e.cardId] = (m[e.cardId] || 0) + (e.qty || 1);
      });
      if (d.commanderId) m[d.commanderId] = (m[d.commanderId] || 0) + 1;
    });
    return m;
  }, [decks]);

  function importDeck(built) {
    const id = uid();
    setDecks((prev) => [...prev, { id, ...built }]);
    setImporting(false);
    setOpenDeck(id);
  }

  function patchDeck(id, patch) {
    setDecks((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function deleteDeck(id) {
    setDecks((prev) => prev.filter((d) => d.id !== id));
    setOpenDeck(null);
  }

  async function autoBuild() {
    if (!deck) return;
    if (deck.format !== "standard" && !commander) return;
    setDrafting(true);
    setDraftNote("Fetching card texts…");
    try {
      const ids = cards.filter((c) => c.scryfallId).map((c) => c.scryfallId);
      const oracle = await fetchOracleTexts(ids);
      setDraftNote("Drafting…");
      // Cards sleeved in other decks are off the table, so a draft never
      // silently claims a copy that's physically somewhere else.
      // computed here rather than read from the outer scope, so this doesn't
      // depend on which branch of the component rendered
      const ident = deck.format === "standard" ? deck.colors || [] : commander?.colors || [];
      const locked = cards.filter(
        (c) => !c.sold && !isBasicLand(c) && identityFits(c, ident) && freeCopies(c) <= 0
      ).length;
      const lockedNote = locked
        ? ` ${locked} card${locked === 1 ? " is" : "s are"} in your other decks and were skipped.`
        : "";
      if (deck.format === "standard") {
        const result = draftDeck60(deck.colors || [], cards, oracle, freeCopies);
        patchDeck(deck.id, { entries: result.entries, basics: result.basics });
        setDraftNote(
          [
            result.theme ? `Built around your ${result.theme} count.` : "",
            result.shortfall > 0
              ? `Pool ran ${result.shortfall} cards short — more ${(deck.colors || []).join("/")} cards would fill it.`
              : "",
            lockedNote.trim(),
          ]
            .filter(Boolean)
            .join(" ")
        );
      } else {
        const result = draftDeck(commander, cards, oracle, freeCopies);
        patchDeck(deck.id, { entries: result.entries, basics: result.basics });
        setDraftNote(
          (result.shortfall > 0
            ? `Drafted, but the pool ran short by ${result.shortfall} spells — add more ${(commander.colors || []).join("/")} cards to your collection to fill it.`
            : "") + lockedNote
        );
      }
    } catch (e) {
      setDraftNote("Couldn't reach Scryfall for card texts. Try again in a moment.");
    }
    setDrafting(false);
  }

  // Basics live outside the entry list because they aren't tied to a specific
  // copy you own — you can always field more.
  // How many of each token you want to bring. Detected tokens start at one;
  // anything can be raised as high as you like or dropped to none.
  function tokenQty(id) {
    const v = deck.tokenCounts?.[id];
    return v === undefined ? 1 : v;
  }

  function setTokenQty(id, n) {
    const next = { ...(deck.tokenCounts || {}) };
    next[id] = Math.max(0, Math.min(99, n));
    patchDeck(deck.id, { tokenCounts: next });
  }

  function addExtraToken(tok) {
    const extras = deck.extraTokens || [];
    if (extras.some((t) => t.id === tok.id)) {
      setTokenQty(tok.id, tokenQty(tok.id) + 1);
      return;
    }
    patchDeck(deck.id, {
      extraTokens: [...extras, { id: tok.id, name: tok.name, ty: tok.typeLine || "" }],
      tokenCounts: { ...(deck.tokenCounts || {}), [tok.id]: 1 },
    });
    setTokenCards((prev) => ({
      ...prev,
      [tok.id]: {
        name: tok.name,
        typeLine: tok.typeLine,
        imageUrl: tok.imageUrl,
        scryfallUri: tok.scryfallUri,
        power: tok.power ?? null,
        toughness: tok.toughness ?? null,
      },
    }));
  }

  function removeExtraToken(id) {
    patchDeck(deck.id, {
      extraTokens: (deck.extraTokens || []).filter((t) => t.id !== id),
      tokenCounts: (() => {
        const n = { ...(deck.tokenCounts || {}) };
        delete n[id];
        return n;
      })(),
    });
  }

  function setBasicQty(name, n) {
    const next = { ...(deck.basics || {}) };
    if (n <= 0) delete next[name];
    else next[name] = Math.min(99, n);
    patchDeck(deck.id, { basics: next });
  }

  function removeEntry(cardId) {
    patchDeck(deck.id, { entries: deck.entries.filter((e) => e.cardId !== cardId) });
  }

  function addEntry(card) {
    if (unavailableReason(card)) return;
    const free = allowsAnyNumber(card, oracleMap[card.scryfallId]?.t);
    // Already in the deck: bump the count instead of refusing, when allowed.
    const existing = deck.entries.find((e) => e.cardId === card.id);
    if (existing) {
      if (deck.format === "standard" || free) setQty(card.id, (existing.qty || 1) + 1);
      else return;
      setAddSearch("");
      setJustAdded(card.name);
      setTimeout(() => addInputRef.current?.focus(), 0);
      return;
    }
    if (deck.format !== "standard" && !free &&
        deck.entries.some((e) => cardById[e.cardId]?.name === card.name))
      return; // commander singleton
    patchDeck(deck.id, {
      entries: [...deck.entries, { cardId: card.id, role: classifyRole(card, ""), qty: 1 }],
    });
    // Clear the box and keep the cursor there so a run of cards can be typed
    // one after another without reaching for the mouse.
    setAddSearch("");
    setJustAdded(card.name);
    setTimeout(() => addInputRef.current?.focus(), 0);
  }

  function exportList() {
    if (!deck) return;
    const lines = [];
    if (deck.format !== "standard" && commander) lines.push(`1 ${commander.name}`);
    deck.entries.forEach((e) => {
      const c = cardById[e.cardId];
      if (c) lines.push(`${e.qty || 1} ${c.name}`);
    });
    Object.entries(deck.basics || {}).forEach(([name, n]) => lines.push(`${n} ${name}`));
    // Tokens go in a commented block: deckbuilders ignore the lines, but the
    // list is there when you're standing at the shop counter.
    if (tokensNeeded.length) {
      lines.push("");
      lines.push("// Tokens needed:");
      tokensNeeded.forEach((t) => {
        const n = tokenQty(t.id);
        if (n > 0) lines.push(`// ${n} ${t.name}${t.ty ? ` (${t.ty})` : ""}`);
      });
    }
    navigator.clipboard?.writeText(lines.join("\n"));
    setDraftNote("Decklist copied to clipboard.");
  }

  // ---------- deck list ----------
  if (!deck) {
    return (
      <main style={{ padding: "16px clamp(14px, 4vw, 30px) 48px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 26 }}>
          {decks.map((d) => {
            const cmd = cardById[d.commanderId];
            const basicsN = Object.values(d.basics || {}).reduce((a, b) => a + b, 0);
            const total =
              (d.format === "standard" ? 0 : 1) +
              d.entries.reduce((s2, e) => s2 + (e.qty || 1), 0) +
              basicsN;
            const isStd = d.format === "standard";
            const target = isStd ? 60 : 100;
            return (
              <div
                key={d.id}
                onClick={() => setOpenDeck(d.id)}
                role="button"
                tabIndex={0}
                aria-label={`Open deck ${d.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenDeck(d.id);
                  }
                }}
                style={{
                  width: 230,
                  cursor: "pointer",
                  background: "rgba(255,255,255,0.045)",
                  border: `1px solid rgba(185,191,199,0.2)`,
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {isStd && (
                  <div
                    style={{
                      height: 46,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      background: "rgba(255,255,255,0.06)",
                    }}
                  >
                    {(d.colors || []).map((k) => (
                      <span
                        key={k}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: MANA[k],
                          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.4)",
                        }}
                      />
                    ))}
                  </div>
                )}
                {cmd?.imageUrl && (
                  <div style={{ height: 120, overflow: "hidden" }}>
                    <img
                      src={cmd.imageUrl}
                      alt=""
                      style={{ width: "100%", marginTop: "-14%", display: "block" }}
                    />
                  </div>
                )}
                <div style={{ padding: "10px 13px 13px" }}>
                  <div className="serif" style={{ fontWeight: 600, fontSize: 15, color: C.goldBright }}>
                    {d.name}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                      color: total === 100 ? C.greenBright : C.parchmentDim,
                      marginTop: 5,
                    }}
                  >
                    {isStd ? "60-card" : "commander"} · {total}/{target}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginBottom: 18 }}>
          <IconButton
            onClick={() => setImporting(true)}
            label="Import a deck"
            icon={<Upload size={14} />}
          />
        </div>

        {importing && (
          <ImportDeckModal
            cards={cards}
            committed={committedAll}
            onClose={() => setImporting(false)}
            onImport={importDeck}
          />
        )}

        <div
          style={{
            border: `1px dashed rgba(185,191,199,0.3)`,
            borderRadius: 10,
            padding: 22,
            maxWidth: 480,
          }}
        >
          <div className="serif" style={{ fontWeight: 600, fontSize: 16, color: C.goldBright, marginBottom: 6 }}>
            New commander deck
          </div>
          {commanders.length === 0 ? (
            <div style={{ fontSize: 13, color: C.parchmentDim, marginBottom: 16 }}>
              No legendary creatures in your collection yet — the commander picker fills in once you
              own some (run Refresh prices &amp; art if type lines are missing).
            </div>
          ) : (
            <select
              defaultValue=""
              onChange={(e) => e.target.value && createDeck(e.target.value)}
              aria-label="Choose a commander"
              style={{
                width: "100%",
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "10px",
                color: C.parchment,
                fontSize: 13.5,
                marginBottom: 20,
              }}
            >
              <option value="" disabled>
                Choose a commander…
              </option>
              {commanders.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.colors?.length ? `(${c.colors.join("")})` : ""}
                </option>
              ))}
            </select>
          )}

          <div
            className="serif"
            style={{ fontWeight: 600, fontSize: 16, color: C.goldBright, marginBottom: 6, paddingTop: 14, borderTop: `1px solid rgba(185,191,199,0.15)` }}
          >
            New 60-card deck
          </div>
          <div style={{ fontSize: 12.5, color: C.parchmentDim, marginBottom: 10 }}>
            Pick one or two colors; the drafter allows up to four copies of a card, capped at what
            you own.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {["W", "U", "B", "R", "G"].map((k) => {
              const on = newColors.includes(k);
              return (
                <button
                  key={k}
                  onClick={() =>
                    setNewColors((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]))
                  }
                  title={k}
                  aria-label={{ W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" }[k]}
                  aria-pressed={on}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: MANA[k],
                    border: "none",
                    cursor: "pointer",
                    boxShadow: on
                      ? `0 0 0 2px ${C.bg}, 0 0 0 3.5px ${C.goldBright}`
                      : "inset 0 0 0 1px rgba(0,0,0,0.4)",
                    opacity: on || newColors.length === 0 ? 1 : 0.4,
                    padding: 0,
                  }}
                />
              );
            })}
            <button
              onClick={createDeck60}
              disabled={newColors.length === 0}
              style={{
                marginLeft: 8,
                background: newColors.length ? STOCK_BG : C.border,
                color: newColors.length ? C.stockInk : C.parchmentDim,
                border: "none",
                borderRadius: 5,
                padding: "8px 16px",
                fontWeight: 700,
                fontSize: 12.5,
                cursor: newColors.length ? "pointer" : "default",
                boxShadow: newColors.length ? STOCK_SHADOW : "none",
              }}
            >
              Create
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ---------- deck detail ----------
  const isStandard = deck.format === "standard";
  const deckSize = isStandard ? 60 : 100;
  const basicsN = Object.values(deck.basics || {}).reduce((a, b) => a + b, 0);
  const entriesN = deck.entries.reduce((s, e) => s + (e.qty || 1), 0);
  const total = (isStandard ? 0 : 1) + entriesN + basicsN;
  const deckValue =
    (!isStandard && commander ? valueOf(commander) / (commander.quantity || 1) : 0) +
    deck.entries.reduce((s, e) => {
      const c = cardById[e.cardId];
      return c ? s + (valueOf(c) / (c.quantity || 1)) * (e.qty || 1) : s;
    }, 0);

  const grouped = {};
  deck.entries.forEach((e) => {
    const c = cardById[e.cardId];
    if (!c) return;
    (grouped[e.role] = grouped[e.role] || []).push(c);
  });
  // Alphabetical within each role, not insertion order — otherwise a card
  // added last month sits above one added five minutes ago for no reason
  // visible to the person looking at the list.
  Object.values(grouped).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));

  const identity = isStandard ? deck.colors || [] : commander?.colors || [];
  // Which decks are holding a given card, for explaining why it's unavailable.
  function heldBy(cardId) {
    return decks
      .filter(
        (d) =>
          d.id !== deck?.id &&
          (d.commanderId === cardId || d.entries.some((e) => e.cardId === cardId))
      )
      .map((d) => d.name);
  }

  // Copies still free to assign to this deck. Basic lands are exempt: they're
  // trivially replaceable, and the quick-add buttons already ignore ownership.
  function freeCopies(c) {
    if (isBasicLand(c)) return 99;
    return (c.quantity || 1) - (committedElsewhere[c.id] || 0);
  }

  // How many copies of this card the deck may hold in total.
  function copyLimit(c) {
    if (isBasicLand(c)) return 99;
    const free = freeCopies(c);
    if (allowsAnyNumber(c, oracleMap[c?.scryfallId]?.t)) return Math.max(0, free);
    return isStandard ? Math.min(4, Math.max(0, free)) : Math.min(1, Math.max(0, free));
  }

  // Shown but not addable: every copy you own is committed to another deck.
  function conflicted(c) {
    if (isBasicLand(c)) return false;
    if (deck.entries.some((e) => e.cardId === c.id)) return false;
    return freeCopies(c) <= 0;
  }

  // A card belongs in the picker if the deck can still take another copy of it —
  // so basics keep showing up until you've added as many as you want.
  function canAddMore(c) {
    const inDeck = deck.entries.find((e) => e.cardId === c.id);
    if (inDeck) return (inDeck.qty || 1) < copyLimit(c);
    const free = isBasicLand(c) || allowsAnyNumber(c, oracleMap[c?.scryfallId]?.t);
    if (!isStandard && !free && deck.entries.some((e) => cardById[e.cardId]?.name === c.name))
      return false; // commander singleton, by name
    return true;
  }

  // Why a listed card can't be taken right now — null means it's available.
  function unavailableReason(c) {
    if (isBasicLand(c)) return null;
    const here = deck.entries.find((e) => e.cardId === c.id)?.qty || 0;
    const free = freeCopies(c) - here;
    if (free > 0) return null;
    const where = [...new Set(heldBy(c.id))];
    const owned = c.quantity || 1;
    if (where.length)
      return `${owned === 1 ? "your copy is" : `all ${owned} copies are`} in ${where
        .slice(0, 2)
        .join(", ")}${where.length > 2 ? ` +${where.length - 2}` : ""}`;
    return `you own ${owned}, all assigned`;
  }

  const addable = cards.filter(
    (c) =>
      !c.sold &&
      c.id !== commander?.id &&
      identityFits(c, identity) &&
      (canAddMore(c) || conflicted(c)) &&
      (!addSearch ||
        c.name.toLowerCase().includes(addSearch.toLowerCase()) ||
        // so "hob 312" or "hob" narrows to a printing
        `${c.set || ""} ${c.collectorNumber || ""}`.toLowerCase().includes(addSearch.toLowerCase()) ||
        `${c.set || ""}${c.collectorNumber || ""}`.toLowerCase().includes(addSearch.toLowerCase().replace(/\s+/g, "")))
  );

  // The row Enter will take, and the one that gets the highlight.
  const firstFreeIndex = addable.findIndex((c) => !unavailableReason(c));

  function setQty(cardId, qty) {
    const c = cardById[cardId];
    const n = Math.max(1, Math.min(copyLimit(c), qty));
    patchDeck(deck.id, {
      entries: deck.entries.map((e) => (e.cardId === cardId ? { ...e, qty: n } : e)),
    });
  }

  return (
    <main style={{ padding: "16px clamp(14px, 4vw, 30px) 48px" }}>
      <button
        onClick={() => setOpenDeck(null)}
        className="mono"
        style={{
          background: "none",
          border: "none",
          color: C.parchmentDim,
          fontSize: 11,
          letterSpacing: 1,
          cursor: "pointer",
          padding: 0,
          marginBottom: 14,
        }}
      >
        ← ALL DECKS
      </button>

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 20 }}>
        {commander?.imageUrl && (
          <div
            className="sleeve"
            style={{
              width: 180,
              borderRadius: 10,
              overflow: "hidden",
              position: "relative",
              flexShrink: 0,
              boxShadow: "0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)",
            }}
          >
            <img src={commander.imageUrl} alt="" style={{ width: "100%", display: "block" }} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 240 }}>
          <input
            value={deck.name}
            onChange={(e) => patchDeck(deck.id, { name: e.target.value })}
            className="serif"
            aria-label="Deck name"
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: C.goldBright,
              background: "transparent",
              border: "1px solid transparent",
              borderRadius: 4,
              padding: "2px 6px",
              marginLeft: -6,
              width: "100%",
              maxWidth: 420,
            }}
          />
          <div
            className="mono"
            style={{ fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.parchmentDim, marginTop: 6 }}
          >
            {isStandard ? "60-card constructed" : commander?.name} · {identity.join("") || "colorless"} ·{" "}
            <span style={{ color: total === deckSize ? C.greenBright : C.goldBright }}>
              {total}/{deckSize}
            </span>{" "}
            · worth {fmt(deckValue)}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button
              onClick={autoBuild}
              disabled={drafting}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: STOCK_BG,
                color: C.stockInk,
                border: "none",
                borderRadius: 5,
                padding: "9px 16px",
                fontWeight: 700,
                fontSize: 13,
                cursor: drafting ? "default" : "pointer",
                boxShadow: STOCK_SHADOW,
              }}
            >
              {drafting ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={15} />}
              {deck.entries.length ? "Re-draft from collection" : "Auto-build from collection"}
            </button>
            <IconButton onClick={exportList} label="Copy decklist" icon={<Download size={14} />} />
            <IconButton
              onClick={() =>
                downloadFile(
                  `${(deck.name || "deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`,
                  deckToText(deck, cardById, commander, tokensNeeded, tokenQty)
                )
              }
              label="Export .txt"
              icon={<Download size={14} />}
            />
            <IconButton
              onClick={() =>
                downloadFile(
                  `${(deck.name || "deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
                  deckToJson(deck, cardById, commander),
                  "application/json"
                )
              }
              label="Export .json"
              icon={<Download size={14} />}
            />
            <IconButton onClick={() => deleteDeck(deck.id)} label="Delete deck" icon={<Trash2 size={14} />} />
            <div style={{ width: 8 }} />
            <IconButton onClick={() => setDeckView("cards")} label="Cards" icon={<LibraryBig size={14} />} active={deckView === "cards"} />
            <IconButton onClick={() => setDeckView("roles")} label="Roles" icon={<Layers size={14} />} active={deckView === "roles"} />
          </div>
          {draftNote && (
            <div className="mono" style={{ fontSize: 11.5, color: C.parchmentDim, marginTop: 10 }}>
              {draftNote}
            </div>
          )}
        </div>
      </div>

      {deckView === "cards" && (
        <DeckGallery
          deck={deck}
          commander={commander}
          cardById={cardById}
          oracleMap={oracleMap}
          isStandard={isStandard}
        />
      )}

      {deckView === "roles" && (
      <>
      <div
        className="mono"
        style={{ fontSize: 9.5, color: C.parchmentDim, marginBottom: 9, letterSpacing: 0.6 }}
      >
        Each row: card name · set and collector number · <span style={{
          background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
          borderRadius: 9, padding: "1px 6px" }}>mana value</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
        {ROLE_ORDER.filter((r) => grouped[r]?.length || (r === "land" && basicsN > 0)).map((role) => (
          <div
            key={role}
            style={{
              background: "rgba(255,255,255,0.045)",
              border: `1px solid rgba(185,191,199,0.18)`,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 9 }}>
              <span
                className="mono"
                style={{
                  fontSize: 9,
                  letterSpacing: 1.6,
                  textTransform: "uppercase",
                  background: STOCK_BG,
                  color: C.stockInk,
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: 3,
                  boxShadow: STOCK_SHADOW,
                }}
              >
                {ROLE_LABELS[role]}
              </span>
              <span className="mono" style={{ fontSize: 10.5, color: C.parchmentDim }}>
                {(grouped[role] || []).reduce(
                  (s2, c) => s2 + (deck.entries.find((e) => e.cardId === c.id)?.qty || 1),
                  0
                ) + (role === "land" ? basicsN : 0)}
                {role === "land"
                  ? `/${isStandard ? 24 : 37}`
                  : !isStandard && ROLE_TARGETS[role]
                  ? `/${ROLE_TARGETS[role]}`
                  : ""}
              </span>
            </div>
            {(grouped[role] || []).map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                  borderBottom: `1px solid rgba(185,191,199,0.08)`,
                  fontSize: 12.5,
                }}
              >
                <span
                  className="serif"
                  style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: C.parchment }}
                >
                  {c.name}
                  <span className="mono" style={{ fontSize: 9, color: C.parchmentDim, marginLeft: 6 }}>
                    {(c.set || "").toUpperCase()}
                    {c.collectorNumber ? ` ${c.collectorNumber}` : ""}
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                  {(isStandard || allowsAnyNumber(c, oracleMap[c.scryfallId]?.t)) && (
                    <span className="mono" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }}>
                      <button
                        onClick={() => setQty(c.id, (deck.entries.find((e) => e.cardId === c.id)?.qty || 1) - 1)}
                        aria-label={`Decrease ${c.name} quantity`}
                        style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.parchmentDim, cursor: "pointer", width: 17, height: 17, lineHeight: 1, padding: 0, fontSize: 11 }}
                      >
                        −
                      </button>
                      <span style={{ color: C.goldBright, minWidth: 14, textAlign: "center" }}>
                        {deck.entries.find((e) => e.cardId === c.id)?.qty || 1}×
                      </span>
                      <button
                        onClick={() => setQty(c.id, (deck.entries.find((e) => e.cardId === c.id)?.qty || 1) + 1)}
                        aria-label={`Increase ${c.name} quantity`}
                        style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.parchmentDim, cursor: "pointer", width: 17, height: 17, lineHeight: 1, padding: 0, fontSize: 11 }}
                      >
                        +
                      </button>
                    </span>
                  )}
                  <span
                    className="mono"
                    title={`Mana value ${c.cmc ?? 0}`}
                    style={{
                      fontSize: 9.5,
                      color: C.parchmentDim,
                      background: "rgba(255,255,255,0.06)",
                      border: `1px solid ${C.border}`,
                      borderRadius: 9,
                      padding: "1px 6px",
                      minWidth: 26,
                      textAlign: "center",
                    }}
                  >
                    {c.cmc ?? 0}
                  </span>
                  <button
                    onClick={() => removeEntry(c.id)}
                    aria-label={`Remove ${c.name} from deck`}
                    style={{ background: "none", border: "none", color: C.parchmentDim, cursor: "pointer", padding: 0, display: "flex" }}
                  >
                    <X size={13} />
                  </button>
                </span>
              </div>
            ))}
            {role === "land" &&
              Object.entries(deck.basics || {}).map(([name, n]) => (
                <div
                  key={name}
                  className="mono"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 0",
                    fontSize: 11.5,
                    color: C.parchmentDim,
                  }}
                >
                  <span style={{ flex: 1 }}>{name}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <button
                      onClick={() => setBasicQty(name, n - 1)}
                      aria-label={`Decrease ${name} quantity`}
                      style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.parchmentDim, cursor: "pointer", width: 17, height: 17, lineHeight: 1, padding: 0, fontSize: 11 }}
                    >
                      −
                    </button>
                    <span style={{ color: C.goldBright, minWidth: 18, textAlign: "center" }}>{n}×</span>
                    <button
                      onClick={() => setBasicQty(name, n + 1)}
                      aria-label={`Increase ${name} quantity`}
                      style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.parchmentDim, cursor: "pointer", width: 17, height: 17, lineHeight: 1, padding: 0, fontSize: 11 }}
                    >
                      +
                    </button>
                  </span>
                  <span style={{ fontSize: 9.5, minWidth: 30, textAlign: "right" }}>basic</span>
                </div>
              ))}
            {role === "land" && (
              <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
                {["Plains", "Island", "Swamp", "Mountain", "Forest"].map((b) => (
                  <button
                    key={b}
                    onClick={() => setBasicQty(b, (deck.basics?.[b] || 0) + 1)}
                    title={`Add a ${b}`}
                    className="mono"
                    style={{
                      background: "transparent",
                      border: `1px solid ${C.border}`,
                      color: C.parchmentDim,
                      borderRadius: 3,
                      padding: "3px 7px",
                      fontSize: 9.5,
                      cursor: "pointer",
                    }}
                  >
                    +{b.slice(0, 2)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      </>
      )}

      <TokensPanel
        tokens={tokensNeeded}
        tokenCards={tokenCards}
        qtyOf={tokenQty}
        onSetQty={setTokenQty}
        onAdd={addExtraToken}
        onRemove={removeExtraToken}
      />

      {/* add cards */}
      <div style={{ marginTop: 24, maxWidth: 560 }}>
        <div
          className="mono"
          style={{ fontSize: 9.5, letterSpacing: 1.6, textTransform: "uppercase", color: C.parchmentDim, marginBottom: 8 }}
        >
          Add from collection ({identity.join("") || "colorless"} identity)
        </div>
        <input
          ref={addInputRef}
          value={addSearch}
          onChange={(e) => {
            setAddSearch(e.target.value);
            if (justAdded) setJustAdded("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const target = addable.find((c) => !unavailableReason(c));
              if (target) addEntry(target);
            }
            if (e.key === "Escape") {
              setAddSearch("");
              setJustAdded("");
            }
          }}
          placeholder="Search your cards…"
          aria-label="Search your cards to add to this deck"
          style={{
            width: "100%",
            background: C.bgPanel2,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "9px 11px",
            color: C.parchment,
            fontSize: 13,
          }}
        />
        {justAdded && !addSearch && (
          <div className="mono" style={{ fontSize: 11, color: C.greenBright, marginTop: 7 }}>
            ✓ {justAdded} added — keep typing for the next one
          </div>
        )}
        {addSearch && (
          <div
            style={{
              border: `1px solid rgba(185,191,199,0.2)`,
              borderTop: "none",
              borderRadius: "0 0 8px 8px",
              maxHeight: 240,
              overflowY: "auto",
            }}
          >
            {addable.slice(0, 30).map((c, i) => {
              const blocked = unavailableReason(c);
              const isFirstFree = i === firstFreeIndex;
              return (
              <div
                key={c.id}
                onClick={() => !blocked && addEntry(c)}
                title={blocked ? `Unavailable — ${blocked}` : undefined}
                role="button"
                tabIndex={blocked ? -1 : 0}
                aria-disabled={!!blocked}
                aria-label={blocked ? `${c.name}, unavailable — ${blocked}` : `Add ${c.name} to deck`}
                onKeyDown={(e) => {
                  if (!blocked && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    addEntry(c);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "6px 12px",
                  cursor: blocked ? "not-allowed" : "pointer",
                  fontSize: 12.5,
                  borderBottom: `1px solid rgba(185,191,199,0.08)`,
                  background: isFirstFree ? "rgba(232,236,241,0.06)" : "transparent",
                  borderLeft: isFirstFree ? `3px solid ${C.goldBright}` : "3px solid transparent",
                  opacity: blocked ? 0.42 : 1,
                }}
              >
                {/* the art is what actually distinguishes one basic from another */}
                <div
                  style={{
                    width: 26,
                    aspectRatio: "5 / 7",
                    borderRadius: 3,
                    overflow: "hidden",
                    flexShrink: 0,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <CardArt card={c} />
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    className="serif"
                    style={{
                      color: C.parchment,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.name}
                    {finishOf(c) !== "nonfoil" && (
                      <span className="mono" style={{ fontSize: 8.5, color: C.gold, marginLeft: 6 }}>
                        FOIL
                      </span>
                    )}
                    {isFirstFree && (
                      <span className="mono" style={{ fontSize: 9, color: C.parchmentDim, marginLeft: 8 }}>
                        ↵
                      </span>
                    )}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 9.5, color: C.parchmentDim, textTransform: "uppercase" }}
                  >
                    {(c.typeLine || "").split("—")[0].trim()}
                    {c.cmc !== undefined && c.cmc !== null ? ` · ${c.cmc} CMC` : ""}
                  </div>
                </div>

                {/* the collector line: which exact printing this is */}
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="mono" style={{ fontSize: 10.5, color: C.goldBright }}>
                    {(c.set || "").toUpperCase()}
                    {c.collectorNumber ? ` #${c.collectorNumber}` : ""}
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: C.parchmentDim }}>
                    {(() => {
                      if (blocked)
                        return <span style={{ color: C.redBright }}>in use — {blocked}</span>;
                      const inDeck = deck.entries.find((e) => e.cardId === c.id);
                      if (inDeck)
                        return (
                          <span style={{ color: C.greenBright }}>
                            {inDeck.qty || 1} in deck · +1 more
                          </span>
                        );
                      return `${collectionLabel(c.collectionId)}${
                        (c.quantity || 1) > 1 ? ` · ×${c.quantity}` : ""
                      }`;
                    })()}
                  </div>
                </div>
              </div>
              );
            })}
            {addable.length === 0 && (
              <div style={{ padding: "10px 12px", fontSize: 12, color: C.parchmentDim }}>
                Nothing in identity matches.
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/* ============================================================
   SETS VIEW — completion tracking + roster with quantity entry
   ============================================================ */

