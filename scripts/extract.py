#!/usr/bin/env python3
"""One-shot mechanical extraction of src/App.jsx into the module tree from the plan.
Pure line-range slicing (no AST) + auto-import-detection by identifier scan.
Run once from repo root: python3 scripts/extract.py
Writes src/lib/*, src/components/ui/*, src/features/**/* and a rewritten src/App.jsx
(App() body kept, everything else replaced by imports) plus src/lib/testExports.js.
"""
import re, os

SRC = "src/App.jsx"
with open(SRC) as f:
    lines = f.readlines()

END_OF_BLOCKS = 12562
APP_START, APP_END = 482, 2086  # App() itself - stays in App.jsx

# name -> destination file, for every top-level declaration that used to live in the
# original monolithic App.jsx. The discovery loop below scans the file itself for every
# top-level `(async function|function|const|export|let|var|class) NAME` and looks each one
# up here, so a name missing from this map is a hard SystemExit at extraction time, not a
# silent mis-slice into the wrong file.
DEST_MAP = {
    "C": "lib/tokens.js", "STOCK_BG": "lib/tokens.js", "STOCK_SHADOW": "lib/tokens.js",
    "RARITY_COLORS": "lib/tokens.js",
    "MANA": "lib/mana.jsx", "renderManaSymbols": "lib/mana.jsx",
    "UNCATEGORIZED": "lib/scryfall.js", "SOLD": "lib/scryfall.js",
    "RARITY_GROUP_ORDER": "lib/scryfall.js", "RARITY_GROUP_LABELS": "lib/scryfall.js",
    "TYPE_FILTERS": "lib/scryfall.js", "cardTypes": "lib/scryfall.js",
    "COLOR_BUCKETS": "lib/scryfall.js", "bucketOf": "lib/scryfall.js",
    "SCRYFALL": "lib/scryfall.js", "RATE_MS": "lib/scryfall.js", "sleep": "lib/scryfall.js",
    "scryfallFetch": "lib/scryfall.js", "scryfallLookup": "lib/scryfall.js",
    "scryfallById": "lib/scryfall.js", "scryfallSearch": "lib/scryfall.js",
    "scryfallByCode": "lib/scryfall.js", "scryfallCollection": "lib/scryfall.js",
    "normalizeCard": "lib/scryfall.js", "FINISHES": "lib/scryfall.js",
    "finishOf": "lib/scryfall.js", "priceForFinish": "lib/scryfall.js",
    "availableFinishes": "lib/scryfall.js", "FRAME_LABELS": "lib/scryfall.js",
    "PROMO_LABELS": "lib/scryfall.js", "treatmentTags": "lib/scryfall.js",
    "fetchOracleTexts": "lib/scryfall.js", "fetchTokenCards": "lib/scryfall.js",
    "uid": "lib/store.js", "store": "lib/store.js",
    "CUR": "lib/format.js", "CURRENCIES": "lib/format.js", "convert": "lib/format.js",
    "unconvert": "lib/format.js", "fmt": "lib/format.js", "dayKey": "lib/format.js",
    "shortDate": "lib/format.js",
    "downloadFile": "lib/downloads.js",
    "Header": "features/collection/Header.jsx",
    "ViewTab": "components/ui/ViewTab.jsx",
    "StatPlaque": "components/ui/StatPlaque.jsx",
    "IconButton": "components/ui/IconButton.jsx",
    "FilterBar": "features/collection/FilterBar.jsx",
    "ChartTooltip": "features/collection/Analytics.jsx",
    "ChartPanel": "features/collection/Analytics.jsx",
    "Analytics": "features/collection/Analytics.jsx",
    "MoversPanel": "features/collection/MoversPanel.jsx",
    "Chip": "components/ui/Chip.jsx",
    "ManaDots": "components/ui/ManaDots.jsx",
    "CardArt": "features/collection/CardTile.jsx",
    "CardFace": "features/collection/CardTile.jsx",
    "CardTile": "features/collection/CardTile.jsx",
    "classifyRole": "features/decks/draftLogic.js",
    "SYNERGY_WORDS": "features/decks/draftLogic.js",
    "synergyScore": "features/decks/draftLogic.js",
    "identityFits": "features/decks/draftLogic.js",
    "ROLE_TARGETS": "features/decks/draftLogic.js",
    "ROLE_LABELS": "features/decks/draftLogic.js",
    "ROLE_ORDER": "features/decks/draftLogic.js",
    "isBasicLand": "features/decks/draftLogic.js",
    "allowsAnyNumber": "features/decks/draftLogic.js",
    "draftDeck": "features/decks/draftLogic.js",
    "draftDeck60": "features/decks/draftLogic.js",
    "authPost": "features/auth/AuthGate.jsx",
    "AuthGate": "features/auth/AuthGate.jsx",
    "ProfileGate": "features/auth/ProfileGate.jsx",
    "KEYWORD_GUIDE": "features/glossary/GlossaryView.jsx",
    "computeGlossarySearchDiagnostic": "features/glossary/GlossaryView.jsx",
    "GlossaryView": "features/glossary/GlossaryView.jsx",
    "LIFE_STARTING": "features/life/LifeCounterView.jsx",
    "LIFE_STORAGE_KEY": "features/life/LifeCounterView.jsx",
    "makeLifePlayer": "features/life/LifeCounterView.jsx",
    "loadSavedLife": "features/life/LifeCounterView.jsx",
    "lifeIconBtn": "features/life/LifeCounterView.jsx",
    "lifeStepBtn": "features/life/LifeCounterView.jsx",
    "lifeTinyBtn": "features/life/LifeCounterView.jsx",
    "lifeCountBtn": "features/life/LifeCounterView.jsx",
    "LifeCounterView": "features/life/LifeCounterView.jsx",
    "DECK_BASICS": "features/decks/deckIO.js", "DECK_SECTIONS": "features/decks/deckIO.js",
    "parseDecklist": "features/decks/deckIO.js", "matchDecklist": "features/decks/deckIO.js",
    "deckToText": "features/decks/deckIO.js", "BASIC_TYPE_LINES": "features/decks/deckIO.js",
    "deckToJson": "features/decks/deckIO.js", "jsonToParsed": "features/decks/deckIO.js",
    "ImportDeckModal": "features/decks/ImportDeckModal.jsx",
    "TokensPanel": "features/decks/TokensPanel.jsx",
    "DeckGallery": "features/decks/DeckGallery.jsx",
    "DecksView": "features/decks/DecksView.jsx",
    "fetchSetInfo": "features/sets/rosterUtils.js",
    "fetchSetRoster": "features/sets/rosterUtils.js",
    "fetchAllSets": "features/sets/rosterUtils.js",
    "fetchAllArtSeriesSets": "features/sets/rosterUtils.js",
    "isArtSeriesSet": "features/sets/rosterUtils.js",
    "fetchArtSeriesCompanions": "features/sets/rosterUtils.js",
    "RARITY_ORDER": "features/sets/rosterUtils.js",
    "RARITY_FILL": "features/sets/rosterUtils.js",
    "groupRosterByName": "features/sets/rosterUtils.js",
    "SetsView": "features/sets/SetsView.jsx",
    "cleanArtCardName": "features/sets/ArtCardsView.jsx",
    "ArtCardsView": "features/sets/ArtCardsView.jsx",
    "CompletionCost": "features/sets/CompletionCost.jsx",
    "Stepper": "components/ui/Stepper.jsx",
    "SelectionBar": "features/collection/SelectionBar.jsx",
    "BulkEditModal": "features/collection/modals/BulkEditModal.jsx",
    "AccountPanel": "features/collection/modals/SettingsModal.jsx",
    "SettingsSection": "features/collection/modals/SettingsModal.jsx",
    "ProfilePinPanel": "features/collection/modals/SettingsModal.jsx",
    "SettingsModal": "features/collection/modals/SettingsModal.jsx",
    "EmptyState": "components/ui/EmptyState.jsx",
    "ModalShell": "components/ui/ModalShell.jsx",
    "Field": "components/ui/Field.jsx", "inputStyle": "components/ui/Field.jsx",
    "MoneyInput": "components/ui/MoneyInput.jsx",
    "AddCardModal": "features/collection/modals/AddCardModal.jsx",
    "FinishPicker": "features/collection/modals/FinishPicker.jsx",
    "TreatmentTags": "features/collection/modals/FinishPicker.jsx",
    "TabButton": "components/ui/TabButton.jsx",
    "CollectionsModal": "features/collection/modals/CollectionsModal.jsx",
    "SellModal": "features/collection/modals/SellModal.jsx",
    "AddCollectionModal": "features/collection/modals/AddCollectionModal.jsx",
    "HEADER_HINTS": "features/collection/modals/ImportModal.jsx",
    "guessMapping": "features/collection/modals/ImportModal.jsx",
    "truthy": "features/collection/modals/ImportModal.jsx",
    "ImportModal": "features/collection/modals/ImportModal.jsx",
    "DetailModal": "features/collection/modals/DetailModal.jsx",
}

# ---- discover every top-level declaration line, in order, and resolve it via DEST_MAP ----
# (regex-scan the file ourselves rather than trusting a hand-maintained line list, so a
# declaration DEST_MAP forgets raises loudly instead of silently merging into its neighbor.)
DECL_RE = re.compile(r"^(async function|function|const|export|let|var|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)")
BLOCKS = []
for i, line in enumerate(lines):
    lineno = i + 1
    if lineno == APP_START or lineno > END_OF_BLOCKS:
        continue
    m = DECL_RE.match(line)
    if not m:
        continue
    kw, name = m.group(1), m.group(2)
    if kw == "export" and name in ("default", "const"):
        continue  # "export default function App" / the __test_* tail, handled elsewhere
    dest = DEST_MAP.get(name)
    if not dest:
        raise SystemExit(f"line {lineno}: top-level declaration {name!r} has no DEST_MAP entry")
    BLOCKS.append((lineno, name, dest))

mapped_names = {n for _, n, _ in BLOCKS}
unused = set(DEST_MAP) - mapped_names
if unused:
    raise SystemExit(f"DEST_MAP has entries never found as a top-level declaration: {unused}")
print(f"Discovered {len(BLOCKS)} top-level declarations, all resolved via DEST_MAP.")

ICONS = ["Plus","Upload","RefreshCw","Search","X","TrendingUp","TrendingDown",
    "Sparkles","Trash2","Pencil","Download","Layers","ChevronDown","Check",
    "AlertCircle","Loader2","LibraryBig","BarChart3","Coins","CheckSquare","Square","MapPin","Tag",
    "RotateCcw","RotateCw","Swords","Users","Settings","Heart","Palette","Copy",
    "Grid3x3","LayoutGrid","Maximize2","ChevronLeft","ChevronRight"]
RECHARTS = ["BarChart","Bar","XAxis","YAxis","Cell","Tooltip","ResponsiveContainer",
    "PieChart","Pie","CartesianGrid","Legend","LineChart","Line","Area","AreaChart"]
REACT_HOOKS = ["useState","useEffect","useMemo","useRef","useCallback"]

# ---- slice ----
starts = [b[0] for b in BLOCKS] + [END_OF_BLOCKS + 1]
by_file = {}
for i, (start, name, dest) in enumerate(BLOCKS):
    end = starts[i + 1] - 1
    # App() itself (APP_START-APP_END) is deliberately excluded from BLOCKS and handled
    # separately below - clamp any block that would otherwise swallow that gap (only
    # RARITY_COLORS, the block immediately before Header, is affected).
    if start < APP_START <= end:
        end = APP_START - 1
    text = "".join(lines[start - 1:end])
    by_file.setdefault(dest, []).append((name, text))

symbol_table = {name: dest for (_, name, dest) in BLOCKS}

def add_export(text, name):
    # anchor on the known declaration keyword forms actually used in this file
    for pat in (f"function {name}(", f"function {name} (", f"const {name} =", f"const {name}=",
                f"async function {name}(", f"async function {name} ("):
        if text.startswith(pat):
            return "export " + text
    # fallback: shouldn't happen given the grep that produced BLOCKS, but don't silently corrupt
    raise SystemExit(f"could not find declaration form for {name!r} at start of block:\n{text[:80]!r}")

def rel_import_path(from_dest, to_dest):
    from_dir = os.path.dirname(from_dest)
    to_no_ext = re.sub(r"\.(jsx|js)$", "", to_dest)
    rel = os.path.relpath(to_no_ext, from_dir)
    if not rel.startswith("."):
        rel = "./" + rel
    return rel

os.makedirs("src/lib", exist_ok=True)

for dest, items in by_file.items():
    body_parts = []
    for name, text in items:
        body_parts.append(add_export(text, name))
    body = "".join(body_parts)

    # collect referenced identifiers (whole-word) actually used in this file's body
    used = set(re.findall(r"[A-Za-z_$][A-Za-z0-9_$]*", body))
    own_names = {n for n, _ in items}

    imports_by_module = {}  # module path/spec -> set of names (or "default:X")
    for sym, sdest in symbol_table.items():
        if sym in own_names:
            continue
        if sym in used and sdest != dest:
            path = rel_import_path(dest, sdest)
            imports_by_module.setdefault(path, set()).add(sym)

    icon_names = sorted(n for n in ICONS if n in used)
    rc_names = sorted(n for n in RECHARTS if n in used)
    hook_names = [h for h in REACT_HOOKS if h in used]
    needs_react = ("React" in used) or bool(hook_names) or ("<" in body and re.search(r"<[A-Za-z]", body))

    header_lines = []
    if needs_react or hook_names:
        spec = "React" if needs_react else ""
        if hook_names:
            spec += (", " if spec else "") + "{ " + ", ".join(hook_names) + " }"
        header_lines.append(f'import {spec} from "react";')
    if icon_names:
        header_lines.append("import { " + ", ".join(icon_names) + ' } from "lucide-react";')
    if rc_names:
        header_lines.append("import { " + ", ".join(rc_names) + ' } from "recharts";')
    if "Papa" in used:
        header_lines.append('import Papa from "papaparse";')
    for path, names in sorted(imports_by_module.items()):
        header_lines.append("import { " + ", ".join(sorted(names)) + f' }} from "{path}";')

    out_path = os.path.join("src", dest)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        f.write("\n".join(header_lines) + ("\n\n" if header_lines else "") + body)

print(f"Wrote {len(by_file)} files.")

# ---- App.jsx: keep only App() itself, add imports for everything it references ----
app_body = "".join(lines[APP_START - 1:APP_END])
used = set(re.findall(r"[A-Za-z_$][A-Za-z0-9_$]*", app_body))
imports_by_module = {}
for sym, sdest in symbol_table.items():
    if sym in used:
        path = "./" + re.sub(r"\.(jsx|js)$", "", sdest)
        imports_by_module.setdefault(path, set()).add(sym)
icon_names = sorted(n for n in ICONS if n in used)
rc_names = sorted(n for n in RECHARTS if n in used)
hook_names = [h for h in REACT_HOOKS if h in used]

header_lines = [f'import React, {{ {", ".join(hook_names)} }} from "react";']
if icon_names:
    header_lines.append("import { " + ", ".join(icon_names) + ' } from "lucide-react";')
if rc_names:
    header_lines.append("import { " + ", ".join(rc_names) + ' } from "recharts";')
if "Papa" in used:
    header_lines.append('import Papa from "papaparse";')
for path, names in sorted(imports_by_module.items()):
    header_lines.append("import { " + ", ".join(sorted(names)) + f' }} from "{path}";')
header_lines.append('export * from "./lib/testExports.js";')

new_app = "\n".join(header_lines) + "\n\n" + "export default function App() {\n" + app_body.split("\n", 1)[1]
with open("src/App.jsx", "w") as f:
    f.write(new_app)
print("Rewrote src/App.jsx")

# ---- testExports.js ----
test_tail = "".join(lines[12562:12573])  # lines 12563-12573
# map __test_X = X  ->  export { X as __test_X } from "<path to X's new home>"
te_lines = []
for m in re.finditer(r"export const (__test_\w+) = (\w+);", test_tail):
    alias, real = m.group(1), m.group(2)
    dest = symbol_table.get(real)
    if not dest:
        raise SystemExit(f"testExports: don't know where {real} moved to")
    path = rel_import_path("lib/testExports.js", dest)
    te_lines.append(f'export {{ {real} as {alias} }} from "{path}";')
with open("src/lib/testExports.js", "w") as f:
    f.write("\n".join(te_lines) + "\n")
print("Wrote src/lib/testExports.js")
