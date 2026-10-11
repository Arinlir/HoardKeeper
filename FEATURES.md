<div align="center">

# 🐉 Binderwyrm — Feature List

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
- [💜 Wishlist](#-wishlist)
- [👁️ Guest view](#️-guest-view--browse-without-the-pin)
- [🔁 Trade binder & playgroup](#-trade-binder--playgroup)
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
| 🇪🇺 | In euros, prices come from **Cardmarket** itself rather than dollars run through an exchange rate — the number you read is the number you'd pay (switch it off in Settings if you'd rather value everything in dollars) |
| 💱 | Multi-currency (USD, EUR, CZK) — all totals shown in your chosen currency, at **auto-updating ECB reference rates** (or your own, if you'd rather) |
| ✨ | **Normal / Foil / Etched** finishes, each with its own live price — foils get an animated holographic sheen and prismatic edge |
| 🏷️ | Printing treatment tags (Showcase, Borderless, Extended art, Serialized...) pulled from Scryfall |
| 💵 | Sold tracking with **realized** vs. **unrealized** gain reported separately — mark a card **traded** instead of sold when the payment was another card, not cash: name what you got back and it's looked up and added for you, cost already carried over from what you gave up |
| ☑️ | Bulk select (shift-click ranges) with bulk edit: collection, location, condition, finish, price, or add-to-deck |
| 🎯 | Adding a card scrolls to it with a highlight; a floating **+** button stays reachable while scrolling |
| 🔎 | Search matches the **rules text printed on the card**, not just its name — find every card that ventures into the dungeon |
| 🧮 | **Search syntax** borrowed from Scryfall: `t:goblin`, `o:"draw a card"`, `c:rg`, `r:mythic`, `set:ltr`, `cmc<=3`, `price>20`, `qty>=4`, `is:foil`, `tag:trade`, `col:vault`, `deck:atraxa`, `f:commander` — negate anything with a leading `-`, join with `or`, and plain words still just search names. A **?** beside the box lists every term, one click to add |
| 🏷️ | **Your own tags** on any card ("trade", "sleeved", "for dad's deck") — added one at a time or to a whole selection at once, searchable with `tag:`, and carried through CSV export and import |
| 🔄 | **Two-sided cards** flip: transform, modal DFCs and art series all show their back face |
| 🃏 | **PROXY** tag: keeps the card in your collection and your decks, but with no value, no share of the collection's cost, and still counted as missing in Sets |

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
Pick any legendary creature you own — the list is alphabetical, and two copies of the same legend are told apart by set, collector number and finish — then auto-draft the 99 from your collection:
- Color identity + singleton, with correct exceptions for **basic lands** and cards that read *"any number of cards named…"*
- Role quotas — lands / ramp / draw / removal / board wipes
- Synergy scoring against your commander's text and creature types

### 🎴 60-card constructed
Pick colors → up to **4 copies** per card, capped by what you actually own, ~24 lands, theme inferred from your most common creature type.

### 🧩 Shared deck features
| Feature | What it does |
|---|---|
| 🚫 Conflict-aware | A card already in another deck shows as unavailable — never double-booked |
| 🛒 Cards you don't own | Search all of Magic, not just your binder: anything you add is marked **to buy**, priced, and one click from your wishlist. The header totals what finishing the deck would cost |
| ✅ Buy it and it's yours | *I own it* turns a placeholder into a real card in your collection — and if one turns up any other way (CSV, wishlist, typed in), the deck links it up on its own |
| 🃏 Test hand | Draw a real seven off a real shuffle, London mulligan and all, then draw a card a turn — the fastest way to find out whether a list keeps |
| 🌊 Mana base check | Coloured sources against what the deck actually demands and when (Karsten's 90% numbers, scaled to deck size), naming the card that sets each bar |
| 🏆 Table record | Wins, losses, win rate and head-to-heads, from the games you played on the Life Counter — not from a meta report |
| 🖼️ Cards view | Browse the deck as art + full rules text |
| ⚙️ Roles view | Edit quotas, see mana-value badges, adjust counts |
| 🪙 Tokens panel | Every token your deck's cards can make, with adjustable quantities and a linger-then-fade counting UI |
| 📤 Export | Plain-text (Moxfield/Archidekt-style) or full-fidelity JSON |
| 🎯 Commander Bracket | Once a Commander deck is fully built, its Bracket (Core / Upgraded / Optimized) is estimated automatically from the official Game Changers it runs — 2-4, since combos, mass land denial and cEDH aren't things a card list can honestly self-report. Override it by hand (up to 5) if you know better |
| ⚖️ Format legality | The deck declares its format — Commander, Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Brawl, Duel — and Binderwyrm checks it against Scryfall's banlists, naming anything banned, restricted, or over the copy limit. A card whose legality hasn't been fetched yet is said to be unchecked rather than assumed legal |
| 🗂️ Your own categories | The six built-in roles are defaults, not a cage: name your own group ("combo pieces", "stax"), move cards into it with one tap, rename it, delete it — deleting a group never deletes its cards |
| 📥 Import | Paste or upload a list — matched against your real collection, respecting cards already committed elsewhere |
| 🏷️ Deck tags | Free-form tags on the deck itself (separate from card tags and categories) — filed under "Deck tags" on the deck page, and searchable from the all-decks filter box below |
| 🔍 Filter your decks | The all-decks screen has a search box that matches on deck name or tag, for anyone with more than a handful of lists |
| 📊 Stats tab | Three charts read straight off the decklist: a mana curve (lands excluded, commander included), a Have-vs-Want colour sources chart built on the same 90%-confidence numbers as the Mana base check, and a category breakdown — no separate data entry, just the deck you already built |
| 🖼️ Set deck image | Pick any card in the deck — not just the commander — to represent it in the all-decks gallery. A 60-card deck with no commander finally gets art in its tile instead of a blank card back |

## 💜 Wishlist

> One of two pages that work **without signing in** — send the link to whoever's buying.

- 🔗 Public at `/w/<your profile>`: no PIN, no account, nothing but the wishlist
- 🔒 Built from an explicit allow-list — your collection, cost basis, totals, decks and history never appear on it
- 🎯 Pick the **exact printing** you want, or say any printing is fine
- 🪜 Priority per card (*top of the list / would like it / someday*), quantity, and a free-text note
- 🔁 **Cards to replace**: tick "want a real copy" on anything you already own — proxies especially — and it joins the list, marked as a stand-in
- 💸 Current market price shown for reference, with **Cardmarket / TCGplayer / Scryfall** links on every entry — the same three, in the same order, on card detail and on a deck's cards-to-buy list
- ✅ *Got it* moves an entry into the collection you choose, as a real card

## 👁️ Guest view — browse without the PIN

> `/v/<your profile>` — someone can look through your binder without getting into it.

- 🔓 **Off until you turn it on**, in Settings → Share your collection. A profile that hasn't opted in answers exactly like one that doesn't exist
- 🗃️ Guests get the **cards** (search included — the same `t:` / `c:` / `cmc<=3` syntax), the **sets** you own cards from, and your **decks**, with today's prices
- 🚫 They never get what you paid, collection totals, gain, value history, where a card is kept, your tags and notes, or anything you've sold — the payload is an explicit allow-list, so a field added next year stays private until someone lists it
- 📖 Strictly read-only: no steppers, no add, no settings, no save path at all
- 🚪 The profile screen offers the door — "No PIN? Browse <name>'s collection read-only" — for profiles that have opened it

## 🔁 Trade binder & playgroup

> The thing a self-hosted tracker can do that a hosted one can't: your playgroup is on your server.

- 🏷️ Mark any card **up for trade** — one card at a time, or a whole selection at once. It stays exactly where it is
- 📤 Share the trade list with its **own switch**, separate from the read-only collection: it appears on your wishlist page and in your playgroup's matches, and nothing else about those cards travels
- 👥 The **Playgroup** tab reads the pages everyone here already publishes and works out who has what: *they want, you have* on one side, *you want, they'll trade* on the other, with a **swap** badge when it goes both ways
- 🔒 No PINs, no vaults, no linking accounts — if someone hasn't shared a page, their match simply doesn't appear
- 🔍 `is:trade` finds your trade list in the search box, and it round-trips through CSV
- 🔁 Once a trade actually happens, **mark the card traded** rather than sold — card for card, not cash. It moves to the Sold shelf the same way a sale would; name what you got back (one card or several) and each one is looked up on Scryfall and added straight to your collection, cost split evenly against what you just gave up — no separate search step, and a name that doesn't match anything is never silently dropped

## 📖 Glossary

A plain-language guide to **~40 keywords and mechanics** — but only the ones that actually appear in *your* cards, with live counts and real examples pulled from your own collection.

## ❤️ Life Counter

<div align="center">

**Full-bleed · 2–10 players · Commander (40) or Normal (20)**

*Coloured seats on black, a hexagon where they meet, and nothing else on screen. Every control is a button — there isn't a dropdown in the whole screen.*

</div>

- 🎨 **A block of colour per seat** with a big rounded numeral turned to face its player — tap the half on your left to lose life, the half on your right to gain it, hold to run (it speeds up the longer you hold). Pick any seat's colour, or a rainbow *Stars* background
- ⬡ **The hub** in the middle opens the menu: format, player count, layout, dice, who starts, day/night, undo, log, decks, which counters to track, new game and exit
- 🧩 **Layout picker** — twenty board arrangements shown as little pictures of themselves (wide seats across the top or bottom, gaps in the board, 2 to 10 seats). Side seats read sideways, the seat across the top reads upside down, and on a tablet or desktop window the top row flips instead
- 🪑 **Seat options** — tap a number: **Background**, **Kill**, **Partners**, **Name**, an exact **Total** keypad, **Crown**, **Initiative**, **Commander** damage, **Flip** the seat around, **Reset**, and a **Size** control for the number
- ⚔️ **Commander damage** has its own view: the seat you're reading shows *Commander damage you've received* with a **Return to game** button, and every other seat becomes a counter for what it has dealt. **Partners** give a seat two commanders, each tracked on its own against the **lethal (21+)** rule
- ☠️ Optional counters, switched on for the whole table: **poison** (flags at 10), **energy**, **experience**, **commander tax** (steps by two), **storm**
- 🎲 **d4–d20**, coin flip, and **Who starts**: every seat goes dark and shows its roll, the winner lights up with the stars, and ties reroll among the tied players only
- 🪦 Knock a seat out (and bring it back); when one player is left, the game is called
- ↩️ **Undo** any change — including a layout change — and a **game log** of rolls, eliminations and exact totals
- 🃏 Give each seat a **commander** — free text, nothing to do with your collection, so it works for the friends who play cards you don't own, and what you type is checked against real cards (tap a suggestion for the exact name). A seat with no name takes its commander's name
- 📊 **Stats** in the menu keeps every finished game and shows wins per player (only seats whose name is filled in) and per commander, plus the latest games — for this device, or for the **whole server** (every signed-in account shares one list of finished games)
- 💫 Floating damage/heal indicators — rapid taps accumulate into one number, linger while you keep tapping, then fade away once you stop
- 💾 Layout, colours, names, partners and counters survive a reload

## 📊 Portfolio charts

Color identity breakdown • Top-value cards • Paid vs. worth by collection • Value over time • Mana curve • Rarity value distribution • Biggest movers since your last refresh

## 🔄 Data & interoperability

- CSV import/export carries **full printing identity** — set, collector number, Scryfall ID, rarity, finish — so a re-import never has to guess which printing a row means
- 📤 **Export in the shape the other site reads**: Binderwyrm (everything, incl. cost basis and sold history), **Archidekt**, **Moxfield**, **ManaBox**, or a pasteable **decklist text** list (`1 Sol Ring (LTC) 59`) for Archidekt, Moxfield, playgroup.gg and friends
- Each format uses that site's own column names, condition words and finish vocabulary, and writes prices in **USD** — no hand-mapping columns after the import screen loads
- Choose whether proxies and sold cards come along; a preview of the first lines is shown before you download
- Deck import/export compatible with the major deckbuilding sites' list formats

## 🔐 Hosting & accounts

<table>
<tr>
<th align="left">🏠 Self-hosted edition</th>
<th align="left">☁️ Cloud edition</th>
</tr>
<tr valign="top">
<td>Zero-dependency Node server, friend-tier <b>PIN profiles</b> so several people can share one install — no database required</td>
<td>Real user accounts — email confirmation, password reset, sessions, rate limiting, account deletion — for running Binderwyrm as a service</td>
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
- 🧪 **~50 automated test suites** covering deck interactions, search syntax, format legality, import/export round-trips, responsive layout, and core financial logic

---

<div align="center">

*Card data and prices courtesy of [Scryfall](https://scryfall.com). Magic: The Gathering is a trademark of Wizards of the Coast; Binderwyrm is an unaffiliated fan project.*

**[⬆ back to top](#-binderwyrm--feature-list)**

</div>
