import React, { useState, useEffect, useMemo, useRef } from "react";
import { BarChart3, Copy, Download, Layers, LibraryBig, Loader2, Search, Shuffle, Sparkles, Tag, Trash2, Upload, Wand2, X } from "lucide-react";
import { BuyLinks } from "../../components/ui/BuyLinks";
import { IconButton } from "../../components/ui/IconButton";
import { downloadFile } from "../../lib/downloads";
import { fmt } from "../../lib/format";
import { MANA } from "../../lib/mana";
import { UNCATEGORIZED, fetchOracleTexts, fetchTokenCards, finishOf, printingPrice, scryfallSearch } from "../../lib/scryfall";
import { store, uid } from "../../lib/store";
import { C, STOCK_BG, STOCK_SHADOW } from "../../lib/tokens";
import { CardArt } from "../collection/CardTile";
import { DeckGallery } from "./DeckGallery";
import { externalsOf, isDeckBuilt, isExternal, makeExternalCard, missingSummary } from "./externals";
import { GoldfishModal } from "./GoldfishModal";
import { ImportDeckModal } from "./ImportDeckModal";
import { TokensPanel } from "./TokensPanel";
import { FORMATS, LEGALITY_LABEL, deckLegality, formatMeta, isSingletonFormat, legalityOf } from "../../lib/formats";
import { BRACKETS, bracketApplies, bracketLabel, effectiveBracket, estimateBracket, isBracketOverridden } from "../../lib/brackets";
import { CardsByColorPanel, LandCountPanel } from "./ManaPanels";
import { coverImageFor, deckCategoryCounts, deckColorCounts, deckManaCurve } from "./deckStats";
import { addTag, allTags, removeTag } from "../../lib/tags";
import { TagEditor } from "../../components/ui/TagEditor";
import { ChartPanel, ChartTooltip } from "../collection/Analytics";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { addDeckCategory, deckCategories, isCustomCategory, removeDeckCategory, renameDeckCategory, setEntryCategory, splitOtherByType } from "./categories";
import { commanderOptions, partnerOptions } from "./commanderPicker";
import { canHavePartner, canPair, combinedIdentity, partnerLabel } from "../../lib/commander";
import { deckRecord, formatRecord, recordsByDeck } from "./record";
import { deckToJson, deckToText } from "./deckIO";
import { ROLE_LABELS, ROLE_ORDER, ROLE_TARGETS, allowsAnyNumber, classifyRole, draftDeck, draftDeck60, identityFits, isBasicLand } from "./draftLogic";
import { analyseManabase } from "./manabase";
import { collectionOptions } from "../../lib/collectionTree";

export function DecksView({ cards, decks, setDecks, games, valueOf, unitValueOf, collections, wishlist, onWishlistCard, onAcquireCard, routeDeckId, onOpenDeckChange }) {
  const collectionLabel = (id) => {
    if (!id || id === UNCATEGORIZED) return "Uncategorized";
    return collections?.find((c) => c.id === id)?.name || "Uncategorized";
  };
  const [openDeck, setOpenDeck] = useState(routeDeckId || null);
  // The open deck is mirrored in the URL (/decks/<id>): report changes up, and
  // follow the URL when back / forward changes it.
  useEffect(() => {
    if (routeDeckId !== undefined && (routeDeckId || null) !== openDeck) setOpenDeck(routeDeckId || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeDeckId]);
  useEffect(() => {
    onOpenDeckChange?.(openDeck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDeck]);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [justAdded, setJustAdded] = useState("");
  const addInputRef = useRef(null);
  // "owned" searches your collection, "any" searches Scryfall for cards you
  // don't have yet. Two buttons rather than one box that guesses.
  const [addMode, setAddMode] = useState("owned");
  const [anyResults, setAnyResults] = useState([]);
  const [anyState, setAnyState] = useState("idle"); // idle | searching | error
  const [showMissing, setShowMissing] = useState(false);
  const [acquireInto, setAcquireInto] = useState(UNCATEGORIZED);
  const [deckView, setDeckView] = useState("cards"); // cards | roles | stats
  const [deckFilter, setDeckFilter] = useState("");
  // Roles view is plain text rows with no art of its own — hovering a row
  // floats the card's image next to the cursor, same idea (and layout) as
  // the Sets roster's art-card preview.
  const [rolePreview, setRolePreview] = useState(null);
  // Which card row has its "move to…" picker open, and the name being typed
  // for a brand-new category.
  const [testing, setTesting] = useState(false);
  const [movingCard, setMovingCard] = useState(null);
  // { mode: "new" | "rename", key?, cardId?, value } — one draft at a time, so
  // naming a category never needs a browser prompt() box.
  const [categoryDraft, setCategoryDraft] = useState(null);
  const [oracleMap, setOracleMap] = useState({});
  const [tokenCards, setTokenCards] = useState({});

  // Sorted, and copies of the same legend carry their printing so you can tell
  // them apart. See commanderPicker.js.
  const commanders = useMemo(() => commanderOptions(cards), [cards]);

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
      // another deck's commanders are physical cards too
      if (d.commanderId) m[d.commanderId] = (m[d.commanderId] || 0) + 1;
      if (d.partnerId) m[d.partnerId] = (m[d.partnerId] || 0) + 1;
    });
    return m;
  }, [decks, openDeck]);
  // One pass over the games for the whole deck list.
  const allRecords = useMemo(() => recordsByDeck(games), [games]);

  const commander = deck ? cards.find((c) => c.id === deck.commanderId) : null;
  // The optional second commander — a partner, a Background, the Doctor's
  // companion. `commandZone` is both (or just the one), for everything that
  // counts, lists or reads colours from the command zone.
  const partner = deck?.partnerId ? cards.find((c) => c.id === deck.partnerId) || null : null;
  const commandZone = [commander, partner].filter(Boolean);
  // Placeholders live on their own deck, but the lookup is shared: merging them
  // in here is what lets every existing `cardById[e.cardId]` keep working,
  // whether an entry points at a card you own or one you're only planning.
  const cardById = useMemo(() => {
    const m = {};
    cards.forEach((c) => (m[c.id] = c));
    decks.forEach((d) => externalsOf(d).forEach((x) => (m[x.id] = x)));
    return m;
  }, [cards, decks]);

  const [newColors, setNewColors] = useState([]);
  const [importing, setImporting] = useState(false);

  // Which tokens this deck can make, and which cards make them. Derived from
  // Scryfall's related-card data rather than guessed from rules text.
  const tokensNeeded = useMemo(() => {
    if (!deck) return [];
    const members = [
      ...commandZone,
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
  }, [deck, commander, partner, cardById, oracleMap]);

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

  // Searching all of Magic, not just the binder. Debounced, and only once
  // there's enough typed to be worth a request; a failed search says so rather
  // than silently showing nothing.
  useEffect(() => {
    if (addMode !== "any") return;
    const q = addSearch.trim();
    if (q.length < 3) {
      setAnyResults([]);
      setAnyState("idle");
      return;
    }
    let live = true;
    setAnyState("searching");
    const t = setTimeout(async () => {
      try {
        const r = await scryfallSearch(q, "cards", 20);
        if (!live) return;
        setAnyResults(r);
        setAnyState("idle");
      } catch (e) {
        if (live) setAnyState("error");
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [addSearch, addMode]);

  // rules text for the browse view, cached in the same store the drafter uses
  useEffect(() => {
    if (!deck) return;
    let live = true;
    const ids = [
      ...commandZone.map((c) => c.scryfallId).filter(Boolean),
      ...deck.entries.map((e) => cardById[e.cardId]?.scryfallId).filter(Boolean),
    ];
    if (ids.length === 0) return;
    (async () => {
      const map = await fetchOracleTexts(ids);
      if (live) setOracleMap(map);
    })();
    return () => { live = false; };
  }, [openDeck, deck?.entries?.length, deck?.commanderId, deck?.partnerId]);

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
      if (d.partnerId) m[d.partnerId] = (m[d.partnerId] || 0) + 1;
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

  // Changing who's in the command zone. It's a straight trade with the 99:
  // the card moving up leaves the list, and whatever it replaces goes back
  // into the list — so a deck that rotates between several possible
  // commanders (pick the one that suits the table) stays at 100 whichever
  // leads. A second commander that can't pair with the new first one drops
  // back into the 99 the same way.
  //
  // `zoneRoles` remembers which category each card had in the 99, so a card
  // that goes up and comes back lands where you'd filed it, not wherever
  // its type line would put it.
  const [commandNote, setCommandNote] = useState("");
  useEffect(() => setCommandNote(""), [openDeck]);
  function zoneTrade(d, { up = [], down = [] }) {
    const zoneRoles = { ...(d.zoneRoles || {}) };
    let entries = d.entries;
    up.forEach((id) => {
      const e = entries.find((x) => x.cardId === id);
      if (!e) return;
      zoneRoles[id] = e.role;
      entries = (e.qty || 1) > 1
        ? entries.map((x) => (x.cardId === id ? { ...x, qty: (x.qty || 1) - 1 } : x))
        : entries.filter((x) => x.cardId !== id);
    });
    down.forEach((id) => {
      const c = cardById[id];
      if (!c) return;
      const e = entries.find((x) => x.cardId === id);
      if (e) {
        entries = entries.map((x) => (x.cardId === id ? { ...x, qty: (x.qty || 1) + 1 } : x));
      } else {
        const role = zoneRoles[id] || classifyRole(c, oracleMap[c.scryfallId]?.t || "");
        entries = [...entries, { cardId: id, role, qty: 1 }];
      }
      delete zoneRoles[id];
    });
    return { entries, zoneRoles };
  }
  function setCommander(cardId) {
    if (!deck || !cardId || cardId === deck.commanderId) return;
    const next = cards.find((c) => c.id === cardId);
    if (!next) return;
    // picking the current second commander as the first = swap them
    if (cardId === deck.partnerId) return swapCommanders();
    const keepPartner = partner && canPair(next, partner);
    const down = [deck.commanderId, !keepPartner && deck.partnerId].filter(Boolean);
    patchDeck(deck.id, {
      commanderId: cardId,
      partnerId: keepPartner ? deck.partnerId : null,
      ...zoneTrade(deck, { up: [cardId], down }),
    });
    const notes = [];
    if (commander) notes.push(`${commander.name} went back into the deck.`);
    if (partner && !keepPartner) notes.push(`${partner.name} can't pair with ${next.name}, so it went back into the deck too.`);
    setCommandNote(notes.join(" "));
  }
  function setPartner(cardId) {
    if (!deck || (cardId || null) === (deck.partnerId || null)) return;
    const down = [deck.partnerId].filter(Boolean);
    patchDeck(deck.id, {
      partnerId: cardId || null,
      ...zoneTrade(deck, { up: cardId ? [cardId] : [], down }),
    });
    setCommandNote(partner ? `${partner.name} went back into the deck.` : "");
  }
  function swapCommanders() {
    if (!deck?.partnerId) return;
    patchDeck(deck.id, { commanderId: deck.partnerId, partnerId: deck.commanderId });
    setCommandNote("");
  }

  async function autoBuild() {
    if (!deck) return;
    if (isSingletonFormat(deck.format) && !commander) return;
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
      const ident = !isSingletonFormat(deck.format) ? deck.colors || [] : combinedIdentity(commandZone);
      const locked = cards.filter(
        (c) => !c.sold && !isBasicLand(c) && identityFits(c, ident) && freeCopies(c) <= 0
      ).length;
      const lockedNote = locked
        ? ` ${locked} card${locked === 1 ? " is" : "s are"} in your other decks and were skipped.`
        : "";
      if (!isSingletonFormat(deck.format)) {
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
        const result = draftDeck(commander, cards, oracle, freeCopies, partner);
        patchDeck(deck.id, { entries: result.entries, basics: result.basics });
        setDraftNote(
          (result.shortfall > 0
            ? `Drafted, but the pool ran short by ${result.shortfall} spells — add more ${combinedIdentity(commandZone).join("/")} cards to your collection to fill it.`
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
    patchDeck(deck.id, {
      entries: deck.entries.filter((e) => e.cardId !== cardId),
      // A placeholder exists only to be in this deck: take it out of the deck
      // and there's nothing left for it to be.
      external: externalsOf(deck).filter((x) => x.id !== cardId),
    });
  }

  // Add a card you don't own. The printing comes from Scryfall, so it carries a
  // price, art and colour identity and behaves like any other card in the deck —
  // it's just marked as one you'd still have to buy.
  function addExternal(printing) {
    const free = allowsAnyNumber(printing, "");
    const already = externalsOf(deck).find(
      (x) => (printing.scryfallId && x.scryfallId === printing.scryfallId) || x.name === printing.name
    );
    if (already) {
      const entry = deck.entries.find((e) => e.cardId === already.id);
      if (entry && (!isSingletonFormat(deck.format) || free)) setQty(already.id, (entry.qty || 1) + 1);
      setAddSearch("");
      setJustAdded(printing.name);
      return;
    }
    if (isSingletonFormat(deck.format) && !free &&
        deck.entries.some((e) => cardById[e.cardId]?.name === printing.name))
      return; // commander singleton, owned or not
    const card = makeExternalCard(printing);
    patchDeck(deck.id, {
      entries: [...deck.entries, { cardId: card.id, role: classifyRole(card, ""), qty: 1 }],
      external: [...externalsOf(deck), card],
    });
    setAddSearch("");
    setJustAdded(printing.name);
    setTimeout(() => addInputRef.current?.focus(), 0);
  }

  // "I bought it": the placeholder becomes a real card in the collection, and
  // the deck entry follows it across.
  function acquire(card, collectionId) {
    if (!onAcquireCard) return;
    const result = onAcquireCard(card, collectionId);
    if (!result?.id) return;
    patchDeck(deck.id, {
      entries: deck.entries.map((e) => (e.cardId === card.id ? { ...e, cardId: result.id } : e)),
      external: externalsOf(deck).filter((x) => x.id !== card.id),
    });
  }

  function addEntry(card) {
    if (unavailableReason(card)) return;
    const free = allowsAnyNumber(card, oracleMap[card.scryfallId]?.t);
    // Already in the deck: bump the count instead of refusing, when allowed.
    const existing = deck.entries.find((e) => e.cardId === card.id);
    if (existing) {
      if (!isSingletonFormat(deck.format) || free) setQty(card.id, (existing.qty || 1) + 1);
      else return;
      setAddSearch("");
      setJustAdded(card.name);
      setTimeout(() => addInputRef.current?.focus(), 0);
      return;
    }
    if (isSingletonFormat(deck.format) && !free &&
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
    if (isSingletonFormat(deck.format)) commandZone.forEach((c) => lines.push(`1 ${c.name}`));
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
        {decks.length > 0 && (
          <div style={{ marginBottom: 16, maxWidth: 320 }}>
            <input
              value={deckFilter}
              onChange={(e) => setDeckFilter(e.target.value)}
              placeholder="Filter by name or tag…"
              aria-label="Filter decks by name or tag"
              style={{
                width: "100%",
                background: C.bgPanel2,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                padding: "8px 11px",
                color: C.parchment,
                fontSize: 13,
              }}
            />
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 26 }}>
          {decks
            .filter((d) => {
              const q = deckFilter.trim().toLowerCase();
              if (!q) return true;
              return (
                d.name.toLowerCase().includes(q) ||
                (d.tags || []).some((t) => t.toLowerCase().includes(q))
              );
            })
            .map((d) => {
            const cmd = cardById[d.commanderId];
            // "Set as deck image" (see DeckGallery) overrides the default
            // commander-art thumbnail — and gives a 60-card deck, which has
            // no commander to fall back on, a thumbnail at all.
            const coverCard = coverImageFor(d, cardById, cmd);
            const basicsN = Object.values(d.basics || {}).reduce((a, b) => a + b, 0);
            const total =
              (d.format === "standard" ? 0 : d.partnerId ? 2 : 1) +
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
                {coverCard?.imageUrl && (
                  <div style={{ height: 120, overflow: "hidden" }}>
                    <img
                      src={coverCard.imageUrl}
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
                  {/* What it's done at the table, if it's been to one. */}
                  {formatRecord(allRecords[d.id]) && (
                    <div
                      className="mono"
                      style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.accent, marginTop: 4 }}
                    >
                      {formatRecord(allRecords[d.id])}
                    </div>
                  )}
                  {/* A built deck's power at a glance — see lib/brackets.js
                      for why this is only ever a Game-Changers estimate. */}
                  {bracketApplies(d.format) && isDeckBuilt(d, cardById) && (
                    <div
                      className="mono"
                      title={isBracketOverridden(d) ? "Set by hand" : "Estimated from Game Changers run"}
                      style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: C.goldBright, marginTop: 4 }}
                    >
                      Bracket: {bracketLabel(effectiveBracket(d, cardById))} ({effectiveBracket(d, cardById)})
                    </div>
                  )}
                  {(d.tags || []).length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                      {d.tags.map((t) => (
                        <span
                          key={t}
                          className="mono"
                          style={{
                            fontSize: 9,
                            letterSpacing: 0.4,
                            padding: "2px 6px",
                            borderRadius: 3,
                            color: C.parchmentDim,
                            border: `1px solid ${C.border}`,
                          }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
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
              No possible commanders in your collection yet — legendary creatures, or cards that say
              they can be your commander. The picker fills in once you own some (run Refresh prices
              &amp; art if type lines are missing).
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
              {commanders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
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
  // "Standard" here means any 60-card constructed format — the deck's declared
  // format decides, and an unrecognised one is treated as 60-card rather than
  // as a commander deck.
  const formatInfo = formatMeta(deck.format);
  const isStandard = !isSingletonFormat(deck.format);
  const deckSize = formatInfo?.size || (isStandard ? 60 : 100);
  const basicsN = Object.values(deck.basics || {}).reduce((a, b) => a + b, 0);
  const entriesN = deck.entries.reduce((s, e) => s + (e.qty || 1), 0);
  const total = (isStandard ? 0 : Math.max(1, commandZone.length)) + entriesN + basicsN;
  const deckValue =
    (!isStandard ? commandZone.reduce((s, c) => s + valueOf(c) / (c.quantity || 1), 0) : 0) +
    deck.entries.reduce((s, e) => {
      const c = cardById[e.cardId];
      return c ? s + (valueOf(c) / (c.quantity || 1)) * (e.qty || 1) : s;
    }, 0);

  // What the deck is still short of, and what buying it would come to.
  const missing = missingSummary(deck, cardById, unitValueOf || ((c) => valueOf(c) / (c.quantity || 1)));
  const wishlistIds = new Set((wishlist || []).map((w) => w.scryfallId).filter(Boolean));

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

  // What this deck has done at the table, from games the Life Counter filed.
  const record = deckRecord(games, deck.id);

  // Banlists, copy limits and "we've never checked this card" — see
  // lib/formats.js.
  const legality = deckLegality(deck, cardById, {
    isBasicLand,
    unlimited: (c) => allowsAnyNumber(c, oracleMap[c.scryfallId]?.t),
  });

  // Same mana-source analysis the Test-hand modal's Mana base tab uses (see
  // manabase.js) — computed here too so the Stats tab can chart it without
  // opening that modal.
  const manaAnalysis = analyseManabase({
    cards: deck.entries.map((e) => ({ card: cardById[e.cardId], qty: e.qty || 1 })).filter((e) => e.card),
    basics: deck.basics || {},
    commander: commandZone,
    oracleOf: (c) => (c?.scryfallId ? oracleMap[c.scryfallId] : null),
    deckSize,
  });
  const curveData = deckManaCurve(deck, cardById, commandZone);
  const colorCountData = deckColorCounts(deck, cardById, commandZone);
  const categoryCountData = deckCategoryCounts(deck, cardById);
  const axisStyle = { fill: C.parchmentDim, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" };

  // The deck's own grouping: the six built-in roles plus anything this deck
  // has named for itself. See categories.js.
  const categories = deckCategories(deck);
  // Non-null only when this deck still has cards parked in "Other spells"
  // that importCategoryFor could now place more specifically -- true for any
  // deck imported before that classifier existed. Lets the "Split Other
  // spells by type" button appear only when it would actually do something.
  const splitAttempt = splitOtherByType(deck, cardById);
  const resortableDeck = splitAttempt !== deck ? splitAttempt : null;
  function moveToCategory(cardId, key) {
    setDecks((prev) => prev.map((d) => (d.id === deck.id ? setEntryCategory(d, cardId, key) : d)));
    setMovingCard(null);
  }
  function createCategory(label, cardId) {
    const result = addDeckCategory(deck, label);
    if (!result) return;
    setDecks((prev) =>
      prev.map((d) => {
        if (d.id !== deck.id) return d;
        const withCat = addDeckCategory(d, label);
        const next = withCat ? withCat.deck : d;
        return cardId ? setEntryCategory(next, cardId, result.key) : next;
      })
    );
    setCategoryDraft(null);
    setMovingCard(null);
  }
  function commitDraft() {
    if (!categoryDraft?.value?.trim()) return setCategoryDraft(null);
    if (categoryDraft.mode === "rename") {
      const { key, value } = categoryDraft;
      setDecks((prev) => prev.map((d) => (d.id === deck.id ? renameDeckCategory(d, key, value) : d)));
      setCategoryDraft(null);
      return;
    }
    createCategory(categoryDraft.value, categoryDraft.cardId);
  }

  const identity = isStandard ? deck.colors || [] : combinedIdentity(commandZone);
  // Which decks are holding a given card, for explaining why it's unavailable.
  function heldBy(cardId) {
    return decks
      .filter(
        (d) =>
          d.id !== deck?.id &&
          (d.commanderId === cardId || d.partnerId === cardId || d.entries.some((e) => e.cardId === cardId))
      )
      .map((d) => d.name);
  }

  // Copies still free to assign to this deck. Basic lands are exempt: they're
  // trivially replaceable, and the quick-add buttons already ignore ownership.
  function freeCopies(c) {
    if (isBasicLand(c)) return 99;
    // A card you don't own isn't a physical copy, so no other deck can be
    // holding it hostage — two decks can plan for the same card.
    if (isExternal(c)) return 99;
    return (c.quantity || 1) - (committedElsewhere[c.id] || 0);
  }

  // How many copies of this card the deck may hold in total.
  function copyLimit(c) {
    if (isBasicLand(c)) return 99;
    const free = freeCopies(c);
    if (allowsAnyNumber(c, oracleMap[c?.scryfallId]?.t)) return Math.max(0, free);
    const cap = formatInfo?.singleton ? 1 : formatInfo?.maxCopies || (isStandard ? 4 : 1);
    return Math.min(cap, Math.max(0, free));
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
    if (isBasicLand(c) || isExternal(c)) return null;
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
      !commandZone.some((z) => z.id === c.id) &&
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
        {commandZone.filter((c) => c.imageUrl).map((c) => (
          <div
            key={c.id}
            className="sleeve"
            style={{
              // two commanders share the space one used to take
              width: commandZone.length > 1 ? 140 : 180,
              borderRadius: 10,
              overflow: "hidden",
              position: "relative",
              flexShrink: 0,
              boxShadow: "0 10px 20px -8px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(232,236,241,0.12)",
            }}
          >
            <img src={c.imageUrl} alt={c.name} style={{ width: "100%", display: "block" }} />
          </div>
        ))}
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
            {isStandard ? formatInfo?.label || "60-card constructed" : commandZone.map((c) => c.name).join(" & ")} · {identity.join("") || "colorless"} ·{" "}
            <span style={{ color: total === deckSize ? C.greenBright : C.goldBright }}>
              {total}/{deckSize}
            </span>{" "}
            · worth {fmt(deckValue)}
            {missing.count > 0 && (
              <>
                {" · "}
                <span style={{ color: C.accent }}>
                  {missing.count} to buy, {fmt(missing.cost)}
                </span>
              </>
            )}
            {bracketApplies(deck.format) && isDeckBuilt(deck, cardById) && (
              <>
                {" · "}
                <span
                  style={{ color: C.goldBright }}
                  title={isBracketOverridden(deck) ? "Set by hand" : "Estimated from the Game Changers this deck runs"}
                >
                  Bracket: {bracketLabel(effectiveBracket(deck, cardById))} ({effectiveBracket(deck, cardById)})
                </span>
              </>
            )}
          </div>

          {/* The command zone: change the commander, add / change / drop a
              second one (partners, a Background, the Doctor's companion),
              or swap which of the two leads. Only legal pairings are
              offered — see lib/commander.js canPair. */}
          {!isStandard && (
            <CommandZoneControls
              commander={commander}
              partner={partner}
              commanderChoices={commanders}
              partnerChoices={partnerOptions(cards, commander)}
              inDeckIds={new Set(deck.entries.map((e) => e.cardId))}
              note={commandNote}
              onCommander={setCommander}
              onPartner={setPartner}
              onSwap={swapCommanders}
            />
          )}

          {/* What this deck is for, and whether it's actually allowed there.
              Buttons rather than a dropdown — nine formats fit, and one tap
              beats two. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10, alignItems: "center" }}>
            {FORMATS.map((f) => {
              const on = (deck.format || "").toLowerCase() === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => patchDeck(deck.id, { format: f.key })}
                  aria-pressed={on}
                  className="mono"
                  title={
                    f.singleton
                      ? `${f.label} — singleton, ${f.size} cards`
                      : `${f.label} — ${f.size}-card minimum, up to ${f.maxCopies} copies`
                  }
                  style={{
                    background: on ? C.accentFill : "transparent",
                    border: `1px solid ${on ? C.accent : C.border}`,
                    color: on ? C.goldBright : C.parchmentDim,
                    borderRadius: 3,
                    padding: "3px 8px",
                    fontSize: 9.5,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* The one bracket rule a decklist can settle on its own is how
              many Game Changers it runs — see lib/brackets.js. Auto shows
              that estimate; the numbered buttons let a person override it
              for what the estimate can't see (a slow combo, mass land
              denial, a genuinely cEDH-tuned list). */}
          {bracketApplies(deck.format) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8, alignItems: "center" }}>
              <span
                className="mono"
                style={{ fontSize: 9.5, letterSpacing: 0.8, textTransform: "uppercase", color: C.parchmentDim, marginRight: 2 }}
              >
                Bracket
              </span>
              <button
                onClick={() => patchDeck(deck.id, { bracketOverride: null })}
                aria-pressed={!isBracketOverridden(deck)}
                className="mono"
                title="Estimate from the Game Changers this deck runs"
                style={{
                  background: !isBracketOverridden(deck) ? C.accentFill : "transparent",
                  border: `1px solid ${!isBracketOverridden(deck) ? C.accent : C.border}`,
                  color: !isBracketOverridden(deck) ? C.goldBright : C.parchmentDim,
                  borderRadius: 3,
                  padding: "3px 8px",
                  fontSize: 9.5,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Auto ({estimateBracket(deck, cardById)})
              </button>
              {BRACKETS.map((b) => {
                const on = deck.bracketOverride === b.n;
                return (
                  <button
                    key={b.n}
                    onClick={() => patchDeck(deck.id, { bracketOverride: b.n })}
                    aria-pressed={on}
                    className="mono"
                    title={`${b.n} — ${b.label}`}
                    style={{
                      background: on ? C.accentFill : "transparent",
                      border: `1px solid ${on ? C.accent : C.border}`,
                      color: on ? C.goldBright : C.parchmentDim,
                      borderRadius: 3,
                      padding: "3px 8px",
                      fontSize: 9.5,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    {b.n}
                  </button>
                );
              })}
            </div>
          )}

          {/* Free-form, deck-level — separate from a card's own tags and from
              the per-entry categories above. Lets a growing deck list be
              browsed the way the filter box on All decks searches: by name
              or by what you called it. */}
          <div style={{ marginTop: 10, maxWidth: 420 }}>
            <TagEditor
              tags={deck.tags || []}
              suggestions={allTags(decks)}
              onChange={(tags) => patchDeck(deck.id, { tags })}
              label="Deck tags"
            />
          </div>

          {/* Banlist check. Silence would be ambiguous — a card whose legality
              we've never fetched isn't legal, it's unknown — so both are said
              out loud. */}
          <div
            data-role="deck-legality"
            style={{
              marginTop: 10,
              maxWidth: 620,
              border: `1px solid ${legality.ok ? "rgba(140,190,140,0.35)" : C.border}`,
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 12,
              color: C.parchmentDim,
              lineHeight: 1.6,
            }}
          >
            {legality.problems.length === 0 && legality.overLimit.length === 0 ? (
              <span style={{ color: legality.unknown ? C.parchmentDim : C.greenBright }}>
                Nothing banned in {formatInfo?.label || deck.format}
                {legality.unknown > 0
                  ? ` — though ${legality.unknown} card${legality.unknown === 1 ? " hasn't" : "s haven't"} been checked yet (run Refresh prices & art).`
                  : "."}
              </span>
            ) : (
              <>
                <div className="mono" style={{ fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.redBright, marginBottom: 5 }}>
                  Not legal in {formatInfo?.label || deck.format}
                </div>
                {legality.problems.map(({ card, status }) => (
                  <div key={card.id} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                    <span className="serif" style={{ color: C.parchment, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {card.name}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: status === "banned" ? C.redBright : C.goldBright, flexShrink: 0 }}>
                      {LEGALITY_LABEL[status]}
                    </span>
                  </div>
                ))}
                {legality.overLimit.map(({ card, qty, limit }) => (
                  <div key={`o-${card.id}`} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                    <span className="serif" style={{ color: C.parchment, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {card.name}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: C.goldBright, flexShrink: 0 }}>
                      {qty} copies · limit {limit}
                    </span>
                  </div>
                ))}
                {legality.unknown > 0 && (
                  <div style={{ marginTop: 4, fontSize: 11.5 }}>
                    {legality.unknown} card{legality.unknown === 1 ? "" : "s"} not checked yet — run
                    Refresh prices &amp; art to fill in their legality.
                  </div>
                )}
              </>
            )}
          </div>

          {/* The table record. Only appears once the deck has actually played —
              an empty scoreboard on a deck you've never sleeved is noise. */}
          {record.played > 0 && (
            <div
              data-role="deck-record"
              style={{
                marginTop: 10,
                maxWidth: 620,
                border: `1px solid ${C.border}`,
                background: C.bgPanel,
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: C.parchmentDim }}>
                  At the table
                </span>
                <span className="serif" style={{ fontSize: 15, color: C.goldBright }}>
                  {record.won}–{record.lost}
                </span>
                <span className="mono" style={{ fontSize: 11, color: C.parchmentDim }}>
                  {Math.round((record.winRate || 0) * 100)}% of {record.played} game
                  {record.played === 1 ? "" : "s"}
                  {record.lastPlayed ? ` · last played ${new Date(record.lastPlayed).toLocaleDateString()}` : ""}
                </span>
              </div>
              {record.opponents.length > 0 && (
                <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(190px, 100%), 1fr))", gap: "2px 16px" }}>
                  {record.opponents.slice(0, 6).map((o) => (
                    <div key={o.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                      <span className="serif" style={{ color: C.parchment, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {o.name}
                      </span>
                      <span className="mono" style={{ fontSize: 10.5, color: o.beat > o.lostTo ? C.greenBright : o.lostTo > o.beat ? C.redBright : C.parchmentDim, flexShrink: 0 }}>
                        {o.beat}–{o.lostTo} in {o.met}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* The shopping list: everything in this deck you don't own yet, what
              it costs, and the two things you'd want to do about it. */}
          {missing.count > 0 && (
            <div
              data-role="deck-missing"
              style={{
                marginTop: 12,
                border: `1px solid ${C.accent}`,
                background: "rgba(111,166,209,0.07)",
                borderRadius: 8,
                padding: "10px 12px",
                maxWidth: 620,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => setShowMissing((v) => !v)}
                  aria-expanded={showMissing}
                  className="mono"
                  style={{
                    background: "none",
                    border: "none",
                    color: C.accent,
                    fontSize: 10.5,
                    letterSpacing: 1.2,
                    textTransform: "uppercase",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {missing.rows.length} card{missing.rows.length === 1 ? "" : "s"} you don't own ·{" "}
                  {fmt(missing.cost)} {showMissing ? "▲" : "▼"}
                </button>
                <span style={{ flex: 1 }} />
                {onWishlistCard && (
                  <button
                    onClick={() => missing.rows.forEach((r) => onWishlistCard(r.card, true))}
                    className="mono"
                    style={{
                      background: "transparent",
                      border: `1px solid ${C.accent}`,
                      color: C.accent,
                      borderRadius: 4,
                      padding: "5px 10px",
                      fontSize: 10,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      cursor: "pointer",
                    }}
                  >
                    All to wishlist
                  </button>
                )}
              </div>

              {showMissing && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {onAcquireCard && collections?.length > 0 && (
                    <label className="mono" style={{ fontSize: 9.5, letterSpacing: 0.8, textTransform: "uppercase", color: C.parchmentDim, display: "flex", alignItems: "center", gap: 7 }}>
                      Bought cards go to
                      <select
                        value={acquireInto}
                        onChange={(e) => setAcquireInto(e.target.value)}
                        aria-label="Collection for cards you buy"
                        style={{ background: C.bgPanel2, border: `1px solid ${C.border}`, borderRadius: 4, color: C.parchment, fontSize: 11.5, padding: "4px 6px", textTransform: "none", letterSpacing: 0 }}
                      >
                        <option value={UNCATEGORIZED}>Uncategorized</option>
                        {collectionOptions(collections).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {missing.rows.map(({ card, qty, each }) => {
                    const wanted = card.scryfallId && wishlistIds.has(card.scryfallId);
                    return (
                      <div
                        key={card.id}
                        data-missing-id={card.id}
                        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, flexWrap: "wrap" }}
                      >
                        <span className="serif" style={{ color: C.parchment, flex: "1 1 140px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {qty > 1 ? `${qty}× ` : ""}
                          {card.name}
                          <span className="mono" style={{ fontSize: 9, color: C.parchmentDim, marginLeft: 6 }}>
                            {(card.set || "").toUpperCase()}
                            {card.collectorNumber ? ` ${card.collectorNumber}` : ""}
                          </span>
                        </span>
                        <span className="mono" style={{ fontSize: 11, color: C.parchmentDim, flexShrink: 0 }}>
                          {fmt(each * qty)}
                        </span>
                        {onWishlistCard && (
                          <button
                            onClick={() => onWishlistCard(card)}
                            aria-label={`${wanted ? "Remove" : "Add"} ${card.name} ${wanted ? "from" : "to"} your wishlist`}
                            className="mono"
                            style={{
                              background: wanted ? C.accentFill : "transparent",
                              border: `1px solid ${wanted ? C.accent : C.border}`,
                              color: wanted ? C.goldBright : C.parchmentDim,
                              borderRadius: 4,
                              padding: "3px 8px",
                              fontSize: 9.5,
                              letterSpacing: 0.6,
                              textTransform: "uppercase",
                              cursor: "pointer",
                              flexShrink: 0,
                            }}
                          >
                            {wanted ? "Wishlisted" : "Wishlist"}
                          </button>
                        )}
                        {onAcquireCard && (
                          <button
                            onClick={() => acquire(card, acquireInto)}
                            aria-label={`I own ${card.name} now — add it to my collection`}
                            className="mono"
                            style={{
                              background: "transparent",
                              border: `1px solid ${C.greenBright}`,
                              color: C.greenBright,
                              borderRadius: 4,
                              padding: "3px 8px",
                              fontSize: 9.5,
                              letterSpacing: 0.6,
                              textTransform: "uppercase",
                              cursor: "pointer",
                              flexShrink: 0,
                            }}
                          >
                            I own it
                          </button>
                        )}
                        {/* And the shops, for the third thing you'd want. */}
                        <BuyLinks card={card} compact />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

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
            <IconButton onClick={() => setTesting(true)} label="Test hand" icon={<Shuffle size={14} />} />
            <IconButton onClick={exportList} label="Copy decklist" icon={<Download size={14} />} />
            <IconButton
              onClick={() =>
                downloadFile(
                  `${(deck.name || "deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`,
                  deckToText(deck, cardById, commandZone, tokensNeeded, tokenQty)
                )
              }
              label="Export .txt"
              icon={<Download size={14} />}
            />
            <IconButton
              onClick={() =>
                downloadFile(
                  `${(deck.name || "deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
                  deckToJson(deck, cardById, commandZone),
                  "application/json"
                )
              }
              label="Export .json"
              icon={<Download size={14} />}
            />
            <IconButton onClick={() => deleteDeck(deck.id)} label="Delete deck" icon={<Trash2 size={14} />} />
            {resortableDeck && (
              <IconButton
                onClick={() => patchDeck(deck.id, resortableDeck)}
                label="Split Other spells by type"
                title="File cards still sitting in Other spells into Artifacts / Instants / Sorceries / etc., by their card type"
                icon={<Wand2 size={14} />}
              />
            )}
            <div style={{ width: 8 }} />
            <IconButton onClick={() => setDeckView("cards")} label="Cards" icon={<LibraryBig size={14} />} active={deckView === "cards"} />
            <IconButton onClick={() => setDeckView("roles")} label="Roles" icon={<Layers size={14} />} active={deckView === "roles"} />
            <IconButton onClick={() => setDeckView("stats")} label="Stats" icon={<BarChart3 size={14} />} active={deckView === "stats"} />
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
          commander={commandZone}
          cardById={cardById}
          oracleMap={oracleMap}
          isStandard={isStandard}
          coverCardId={deck.coverCardId}
          onSetCover={(cardId) =>
            patchDeck(deck.id, { coverCardId: deck.coverCardId === cardId ? null : cardId })
          }
          onRemove={removeEntry}
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
        {categories
          .filter((cat) => grouped[cat.key]?.length || (cat.key === "land" && basicsN > 0) || cat.custom)
          .map((cat) => {
          const role = cat.key;
          return (
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
                {cat.label}
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
            {/* A category you made can be renamed or dropped; the built-in six
                can't, because the drafter fills them by name. Dropping one
                never drops its cards — they fall back to Other spells. */}
            {cat.custom && categoryDraft?.mode === "rename" && categoryDraft.key === role && (
              <input
                autoFocus
                value={categoryDraft.value}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, value: e.target.value })}
                onBlur={commitDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitDraft();
                  if (e.key === "Escape") setCategoryDraft(null);
                }}
                aria-label="Rename category"
                style={{
                  width: "100%",
                  minWidth: 0,
                  background: C.bgPanel2,
                  border: `1px solid ${C.accent}`,
                  borderRadius: 6,
                  padding: "5px 8px",
                  color: C.parchment,
                  fontSize: 12,
                  marginBottom: 8,
                }}
              />
            )}
            {cat.custom && (
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button
                  onClick={() => setCategoryDraft({ mode: "rename", key: role, value: cat.label })}
                  className="mono"
                  style={{ background: "none", border: `1px solid ${C.border}`, color: C.parchmentDim, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", padding: "2px 7px", borderRadius: 3, cursor: "pointer" }}
                >
                  Rename
                </button>
                <button
                  onClick={() =>
                    setDecks((prev) =>
                      prev.map((d) => (d.id === deck.id ? removeDeckCategory(d, role) : d))
                    )
                  }
                  className="mono"
                  style={{ background: "none", border: `1px solid ${C.border}`, color: C.parchmentDim, fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", padding: "2px 7px", borderRadius: 3, cursor: "pointer" }}
                >
                  Delete group
                </button>
              </div>
            )}
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
                onMouseEnter={(ev) => setRolePreview({ card: c, y: ev.clientY })}
                onMouseMove={(ev) => setRolePreview({ card: c, y: ev.clientY })}
                onMouseLeave={() => setRolePreview(null)}
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
                  {isExternal(c) && (
                    <span
                      className="mono"
                      title="You don't own this one yet"
                      style={{
                        fontSize: 8,
                        letterSpacing: 0.8,
                        marginLeft: 6,
                        padding: "1px 5px",
                        border: `1px solid ${C.accent}`,
                        color: C.accent,
                        borderRadius: 3,
                        verticalAlign: "1px",
                      }}
                    >
                      TO BUY
                    </span>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                  {(isStandard || allowsAnyNumber(c, oracleMap[c.scryfallId]?.t)) && (
                    <span className="mono" style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11 }}>
                      <button
                        onClick={() => setQty(c.id, (deck.entries.find((e) => e.cardId === c.id)?.qty || 1) - 1)}
                        aria-label={`Decrease ${c.name} quantity`}
                        className="qty-btn-sm"
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
                        className="qty-btn-sm"
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
                    onClick={() => setMovingCard(movingCard === c.id ? null : c.id)}
                    aria-label={`Move ${c.name} to another category`}
                    title="Move to another category"
                    style={{ background: "none", border: "none", color: movingCard === c.id ? C.goldBright : C.parchmentDim, cursor: "pointer", padding: 0, display: "flex" }}
                  >
                    <Tag size={12} />
                  </button>
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
            {/* Moving a card is a row of buttons, not a dropdown: on a phone
                it's one tap, and you can see every group you have. */}
            {(grouped[role] || []).some((c) => c.id === movingCard) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "6px 0 2px" }}>
                {categories
                  .filter((x) => x.key !== role)
                  .map((x) => (
                    <button
                      key={x.key}
                      onClick={() => moveToCategory(movingCard, x.key)}
                      className="mono"
                      style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.parchmentDim, borderRadius: 3, padding: "3px 7px", fontSize: 9.5, cursor: "pointer" }}
                    >
                      {x.label}
                    </button>
                  ))}
                <button
                  onClick={() => setCategoryDraft({ mode: "new", value: "", cardId: movingCard })}
                  className="mono"
                  style={{ background: "transparent", border: `1px solid ${C.accent}`, color: C.accent, borderRadius: 3, padding: "3px 7px", fontSize: 9.5, cursor: "pointer" }}
                >
                  + New
                </button>
              </div>
            )}
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
            {grouped[role]?.length === 0 || !grouped[role] ? (
              <div style={{ fontSize: 11.5, color: C.parchmentDim, fontStyle: "italic" }}>
                {cat.custom ? "Empty — move cards here with the tag button on each row." : ""}
              </div>
            ) : null}
          </div>
          );
        })}
        {/* A group the app didn't think of. */}
        <div
          style={{
            border: `1px dashed rgba(185,191,199,0.3)`,
            borderRadius: 10,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {categoryDraft?.mode === "new" ? (
            <>
              <input
                autoFocus
                value={categoryDraft.value}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitDraft();
                  if (e.key === "Escape") setCategoryDraft(null);
                }}
                placeholder="Combo pieces…"
                aria-label="New category name"
                style={{
                  background: C.bgPanel2,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  padding: "7px 9px",
                  color: C.parchment,
                  fontSize: 12.5,
                  width: "100%",
                  minWidth: 0,
                }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={commitDraft}
                  className="mono"
                  style={{ background: STOCK_BG, color: C.stockInk, border: "none", borderRadius: 4, padding: "5px 10px", fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", cursor: "pointer" }}
                >
                  Add
                </button>
                <button
                  onClick={() => setCategoryDraft(null)}
                  className="mono"
                  style={{ background: "none", border: `1px solid ${C.border}`, color: C.parchmentDim, borderRadius: 4, padding: "5px 10px", fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => setCategoryDraft({ mode: "new", value: "" })}
              style={{ background: "none", border: "none", color: C.parchmentDim, cursor: "pointer", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}
            >
              <Layers size={14} /> New category
            </button>
          )}
        </div>
      </div>

      {rolePreview && rolePreview.card.imageUrl && (
        <div
          style={{
            position: "fixed",
            left: 24,
            top: Math.min(Math.max(rolePreview.y - 140, 16), window.innerHeight - 300),
            zIndex: 60,
            pointerEvents: "none",
            width: 200,
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 20px 40px -10px rgba(0,0,0,0.85), 0 0 0 1px rgba(232,236,241,0.2)",
          }}
        >
          <img
            src={rolePreview.card.imageUrl}
            alt={rolePreview.card.name}
            style={{ width: "100%", display: "block" }}
          />
        </div>
      )}
      </>
      )}

      {deckView === "stats" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 16 }}>
          <ChartPanel title="MANA CURVE" subtitle="Nonland cards by mana value" height={200}>
            <BarChart data={curveData} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} stroke={C.border} />
              <XAxis dataKey="name" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(201,162,39,0.08)" }} />
              <Bar dataKey="Cards" fill={C.gold} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartPanel>

          {colorCountData.length > 0 && <CardsByColorPanel data={colorCountData} />}
          <LandCountPanel plan={manaAnalysis.landPlan} />

          {categoryCountData.length > 0 && (
            <ChartPanel title="CATEGORIES" subtitle="Cards per role" height={200}>
              <BarChart data={categoryCountData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid horizontal={false} stroke={C.border} />
                <XAxis type="number" tick={axisStyle} axisLine={{ stroke: C.border }} tickLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={92}
                  tick={{ ...axisStyle, fontSize: 10.5 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(201,162,39,0.08)" }} />
                <Bar dataKey="Cards" fill={C.gold} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ChartPanel>
          )}
        </div>
      )}

      {testing && (
        <GoldfishModal
          deck={deck}
          cardById={cardById}
          commander={commandZone}
          oracleMap={oracleMap}
          deckSize={deckSize}
          onClose={() => setTesting(false)}
        />
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
          Add cards ({identity.join("") || "colorless"} identity)
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {[
            { key: "owned", label: "Your cards" },
            { key: "any", label: "Any card" },
          ].map((m) => {
            const on = addMode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => {
                  setAddMode(m.key);
                  setAnyResults([]);
                  setTimeout(() => addInputRef.current?.focus(), 0);
                }}
                aria-pressed={on}
                className="mono"
                style={{
                  background: on ? C.accentFill : "transparent",
                  color: on ? C.goldBright : C.parchmentDim,
                  border: `1px solid ${on ? C.accent : C.border}`,
                  borderRadius: 5,
                  padding: "5px 11px",
                  fontSize: 10,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {m.label}
              </button>
            );
          })}
          {addMode === "any" && (
            <span style={{ fontSize: 11, color: C.parchmentDim, alignSelf: "center" }}>
              Anything you add here is marked as a card you don't own yet.
            </span>
          )}
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
              if (addMode === "any") {
                if (anyResults[0]) addExternal(anyResults[0]);
              } else {
                const target = addable.find((c) => !unavailableReason(c));
                if (target) addEntry(target);
              }
            }
            if (e.key === "Escape") {
              setAddSearch("");
              setJustAdded("");
            }
          }}
          placeholder={addMode === "any" ? "Search every Magic card…" : "Search your cards…"}
          aria-label={addMode === "any" ? "Search all Magic cards to add to this deck" : "Search your cards to add to this deck"}
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
        {addSearch && addMode === "any" && (
          <div
            data-role="any-card-results"
            style={{
              border: `1px solid rgba(185,191,199,0.2)`,
              borderTop: "none",
              borderRadius: "0 0 8px 8px",
              maxHeight: 240,
              overflowY: "auto",
            }}
          >
            {anyState === "searching" && anyResults.length === 0 && (
              <div style={{ padding: "10px 12px", fontSize: 12, color: C.parchmentDim, display: "flex", alignItems: "center", gap: 7 }}>
                <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Searching Scryfall…
              </div>
            )}
            {anyState === "error" && (
              <div style={{ padding: "10px 12px", fontSize: 12, color: C.redBright }}>
                Couldn't reach Scryfall. Try again in a moment.
              </div>
            )}
            {anyResults.map((p) => {
              const offIdentity = !identityFits(p, identity);
              const owned = cards.find(
                (c) => !c.sold && ((p.scryfallId && c.scryfallId === p.scryfallId) || c.name === p.name)
              );
              return (
                <div
                  key={p.scryfallId}
                  onClick={() => addExternal(p)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Add ${p.name} to deck as a card you don't own`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      addExternal(p);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "6px 12px",
                    cursor: "pointer",
                    fontSize: 12.5,
                    borderBottom: `1px solid rgba(185,191,199,0.08)`,
                    opacity: offIdentity ? 0.5 : 1,
                  }}
                >
                  <div style={{ width: 26, aspectRatio: "5 / 7", borderRadius: 3, overflow: "hidden", flexShrink: 0, border: `1px solid ${C.border}` }}>
                    <CardArt card={p} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="serif" style={{ color: C.parchment, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.name}
                    </div>
                    <div className="mono" style={{ fontSize: 9.5, color: C.parchmentDim, textTransform: "uppercase" }}>
                      {(p.typeLine || "").split("—")[0].trim()}
                      {offIdentity ? " · outside this deck's identity" : ""}
                      {owned ? " · you own this" : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="mono" style={{ fontSize: 10.5, color: C.goldBright }}>
                      {(p.set || "").toUpperCase()}
                      {p.collectorNumber ? ` #${p.collectorNumber}` : ""}
                    </div>
                    <div className="mono" style={{ fontSize: 9, color: C.parchmentDim }}>
                      {fmt(printingPrice(p))}
                    </div>
                  </div>
                </div>
              );
            })}
            {anyState === "idle" && anyResults.length === 0 && addSearch.trim().length >= 3 && (
              <div style={{ padding: "10px 12px", fontSize: 12, color: C.parchmentDim }}>
                Nothing found — check the spelling.
              </div>
            )}
            {addSearch.trim().length < 3 && (
              <div style={{ padding: "10px 12px", fontSize: 12, color: C.parchmentDim }}>
                Keep typing — three letters and it'll search.
              </div>
            )}
          </div>
        )}

        {addSearch && addMode === "owned" && (
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


// Small selects under the deck name. A plain <select> each: the choices are
// already sorted and labelled by commanderPicker.js, and a deck changes its
// commander rarely enough that one more tap isn't worth a custom widget.
// Options already in this deck's 99 come first, in their own group — a deck
// that rotates commanders keeps its candidates in the list, and those are
// the ones you're choosing between.
function GroupedOptions({ choices, inDeckIds }) {
  const inDeck = choices.filter((o) => inDeckIds.has(o.id));
  const rest = choices.filter((o) => !inDeckIds.has(o.id));
  const opts = (list) => list.map((o) => (
    <option key={o.id} value={o.id}>
      {o.label}
    </option>
  ));
  if (inDeck.length === 0) return opts(rest);
  return (
    <>
      <optgroup label="In this deck">{opts(inDeck)}</optgroup>
      {rest.length > 0 && <optgroup label="Rest of your collection">{opts(rest)}</optgroup>}
    </>
  );
}

function CommandZoneControls({ commander, partner, commanderChoices, partnerChoices, inDeckIds = new Set(), note, onCommander, onPartner, onSwap }) {
  const selectStyle = {
    background: C.bgPanel2,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "6px 8px",
    color: C.parchment,
    fontSize: 12.5,
    maxWidth: 300,
  };
  const labelStyle = { display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.parchmentDim, letterSpacing: 0.5, textTransform: "uppercase" };
  // The current second commander may not be in partnerChoices (a pairing
  // made before its partner data was known) — keep it selectable so the
  // select never silently shows the wrong thing.
  const pChoices = partner && !partnerChoices.some((o) => o.id === partner.id)
    ? [{ id: partner.id, label: partner.name }, ...partnerChoices]
    : partnerChoices;
  const showPartner = !!partner || canHavePartner(commander);
  const hint = partnerLabel(commander);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 10, alignItems: "center" }}>
      <label className="mono" style={labelStyle}>
        Commander
        <select
          value={commander?.id || ""}
          onChange={(e) => onCommander(e.target.value)}
          aria-label="Change commander"
          style={selectStyle}
        >
          {!commander && <option value="">Choose a commander…</option>}
          {commander && !commanderChoices.some((o) => o.id === commander.id) && (
            <option value={commander.id}>{commander.name}</option>
          )}
          {commander && commanderChoices.some((o) => o.id === commander.id) && !inDeckIds.has(commander.id) && (
            // the current commander, pinned above the groups so it's always the shown value
            <option value={commander.id}>{commanderChoices.find((o) => o.id === commander.id).label}</option>
          )}
          <GroupedOptions choices={commanderChoices.filter((o) => o.id !== commander?.id)} inDeckIds={inDeckIds} />
        </select>
      </label>
      {showPartner && (
        <label className="mono" style={labelStyle} title={hint ? `${commander?.name}: ${hint}` : undefined}>
          Second commander
          <select
            value={partner?.id || ""}
            onChange={(e) => onPartner(e.target.value || null)}
            aria-label="Second commander"
            style={selectStyle}
          >
            <option value="">{pChoices.length ? "None" : "None — you own no legal partner"}</option>
            {partner && (
              <option value={partner.id}>{pChoices.find((o) => o.id === partner.id)?.label || partner.name}</option>
            )}
            <GroupedOptions choices={pChoices.filter((o) => o.id !== partner?.id)} inDeckIds={inDeckIds} />
          </select>
        </label>
      )}
      {partner && (
        <button
          onClick={onSwap}
          className="mono"
          aria-label="Swap commanders"
          title="Make the second commander the first (deck image and name order)"
          style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, color: C.parchmentDim, fontSize: 11, padding: "6px 10px", cursor: "pointer" }}
        >
          ⇄ Swap
        </button>
      )}
      {showPartner && hint && (
        <span style={{ fontSize: 11.5, color: C.parchmentDim, flexBasis: "100%" }}>
          {commander?.name} has {hint}.
        </span>
      )}
      {note && <span style={{ fontSize: 12, color: C.accent, flexBasis: "100%" }}>{note}</span>}
    </div>
  );
}
