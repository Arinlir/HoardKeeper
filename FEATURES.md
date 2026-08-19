<div align="center">

# 🐉 HoardKeeper — Feature List

*A self-hosted Magic: The Gathering collection tracker*

[![License: MIT](https://img.shields.io/badge/license-MIT-6a5acd?style=for-the-badge)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/self--hosted-Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](#-hosting--accounts)
[![Data source](https://img.shields.io/badge/data-Scryfall-c9a227?style=for-the-badge)](https://scryfall.com)
[![Support](https://img.shields.io/badge/support-Ko--fi-ff5e5b?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/Arinlir)

</div>

---

## 📚 Table of Contents

- [🗂️ Collection tracking](#️-collection-tracking)
- [💰 Cost basis](#-cost-basis)
- [➕ Adding cards](#-adding-cards)
- [📦 Sets](#-sets)
- [🃏 Deck building](#-deck-building)
- [📖 Glossary](#-glossary)
- [❤️ Life Counter](#️-life-counter)
- [📊 Portfolio charts](#-portfolio-charts)
- [🔄 Data & interoperability](#-data--interoperability)
- [🔐 Hosting & accounts](#-hosting--accounts)
- [🎨 Design](#-design)
- [⚡ Performance & reliability](#-performance--reliability)

---

## 🗂️ Collection tracking

| | |
|---|---|
| 🖼️ | Visual card grid with search, sorting by name, value, gain, or date added |
| 🔍 | Filter by collection, card type, and color identity |
| 💱 | Multi-currency (USD, EUR, CZK) — all totals shown in your chosen currency |
| ✨ | **Normal / Foil / Etched** finishes, each with its own live price — foils get an animated holographic sheen and prismatic edge |
| 🏷️ | Printing treatment tags (Showcase, Borderless, Extended art, Serialized...) pulled from Scryfall |
| 💵 | Sold tracking with **realized** vs. **unrealized** gain reported separately |
| ☑️ | Bulk select (shift-click ranges) with bulk edit: collection, location, condition, finish, price, or add-to-deck |
| 🎯 | Adding a card scrolls to it with a highlight; a floating **+** button stays reachable while scrolling |

## 💰 Cost basis

> Built for people who buy **sealed product**, not just singles.

- A collection's purchase total splits **evenly** across its cards by default
- Individual cards can carry their **own** purchase price when bought separately
- Live allocation preview before you add a card
- A clear warning when a collection's individual prices exceed its stated total
- CSV import lets you choose: prices join the **collection total** (boosters, bundles) or stay **per-card** (singles)

## ➕ Adding cards

<table>
<tr><td width="120"><b>🔤 By name</b></td><td>Search returns matching cards → then every printing of the one you pick, so you always choose the exact copy you own. Optional filters: set, type, rarity, color.</td></tr>
<tr><td><b>🔢 By code</b></td><td>Enter the set code + collector number printed on the card. Built for rapid entry through a stack.</td></tr>
<tr><td><b>📥 Mass add</b></td><td>The dialog stays open across a batch — collection, finish, and condition persist, with a running "added this session" list.</td></tr>
<tr><td><b>🩹 Fix bad data</b></td><td>"Change art" swaps a card's printing; "wrong card" re-identifies it entirely — both preserve quantity, condition, collection, location, and cost basis.</td></tr>
</table>

## 📦 Sets

- ✅ Completion percentage per set, with **per-rarity progress bars**
- 📋 Full set roster from Scryfall with **+/− steppers**, filterable to All / Missing / Owned
- 💸 Estimated cost to **complete a set** at current market prices
- 🖱️ Hover any roster card for an artwork preview, plus a direct Cardmarket link

## 🃏 Deck building

### 👑 Commander
Pick any legendary creature you own → auto-draft the 99 from your collection:
- Color identity + singleton, with correct exceptions for **basic lands** and cards that read *"any number of cards named…"*
- Role quotas — lands / ramp / draw / removal / board wipes
- Synergy scoring against your commander's text and creature types

### 🎴 60-card constructed
Pick colors → up to **4 copies** per card, capped by what you actually own, ~24 lands, theme inferred from your most common creature type.

### 🧩 Shared deck features
| Feature | What it does |
|---|---|
| 🚫 Conflict-aware | A card already in another deck shows as unavailable — never double-booked |
| 🖼️ Cards view | Browse the deck as art + full rules text |
| ⚙️ Roles view | Edit quotas, see mana-value badges, adjust counts |
| 🪙 Tokens panel | Every token your deck's cards can make, with adjustable quantities and a linger-then-fade counting UI |
| 📤 Export | Plain-text (Moxfield/Archidekt-style) or full-fidelity JSON |
| 📥 Import | Paste or upload a list — matched against your real collection, respecting cards already committed elsewhere |

## 📖 Glossary

A plain-language guide to **~40 keywords and mechanics** — but only the ones that actually appear in *your* cards, with live counts and real examples pulled from your own collection.

## ❤️ Life Counter

<div align="center">

**Full-screen · 2–6 players · Commander (40) or Normal (20)**

</div>

- 🔄 Seat rotation for pass-and-play, state persists across reloads
- ⚔️ Per-opponent commander damage tracking with a **lethal (21+)** highlight
- 💫 Floating damage/heal indicators — rapid taps accumulate into one number, linger while you keep tapping, then fade away once you stop

## 📊 Portfolio charts

Color identity breakdown • Top-value cards • Paid vs. worth by collection • Value over time • Mana curve • Rarity value distribution • Biggest movers since your last refresh

## 🔄 Data & interoperability

- CSV import/export carries **full printing identity** — set, collector number, Scryfall ID, rarity, finish — so a re-import never has to guess which printing a row means
- Deck import/export compatible with the major deckbuilding sites' list formats

## 🔐 Hosting & accounts

<table>
<tr>
<th align="left">🏠 Self-hosted edition</th>
<th align="left">☁️ Cloud edition</th>
</tr>
<tr valign="top">
<td>Zero-dependency Node server, friend-tier <b>PIN profiles</b> so several people can share one install — no database required</td>
<td>Real user accounts — email confirmation, password reset, sessions, rate limiting, account deletion — for running HoardKeeper as a service</td>
</tr>
</table>

- ⚙️ Manage your profile from Settings: **switch users**, **change your PIN**, or **delete your profile**
- ☕ A Support section with a [donation link](https://ko-fi.com/Arinlir) for the project

## 🎨 Design

- A cohesive **"silvered playmat"** identity — graphite felt, cardstock captions, silver stitching — consistent across every view and modal
- Fully responsive: swipeable nav on phones, adaptive grids, fluid spacing instead of fixed desktop-only padding

## ⚡ Performance & reliability

- 🚀 Card pricing and rendering optimized to avoid full-collection rescans — stays responsive at hundreds of cards
- 🧠 Memoized card tiles, so unrelated interface changes don't force the whole grid to re-render
- 🧪 **Ten automated test suites** covering deck interactions, import/export round-trips, responsive layout, and core financial logic

---

<div align="center">

*Card data and prices courtesy of [Scryfall](https://scryfall.com). Magic: The Gathering is a trademark of Wizards of the Coast; HoardKeeper is an unaffiliated fan project.*

**[⬆ back to top](#-hoardkeeper--feature-list)**

</div>
