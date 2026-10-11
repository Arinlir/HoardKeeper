/*
 * What a deck has actually done at the table.
 *
 * Every other site can tell you what a deck costs and what the internet thinks
 * of it. None of them can tell you that your Treebeard deck has won two of
 * eleven and loses to Kevin's Atraxa every time — because none of them are
 * also the life counter you play with. This is that join: games come out of
 * the Life Counter, decks are the ones in your collection, and the record is
 * simply a read over the games.
 *
 * Games are stored oldest-last (newest first), and nothing here mutates them.
 */

export function gamesForDeck(games, deckId) {
  if (!deckId) return [];
  return (games || []).filter((g) => (g.seats || []).some((s) => s.deckId === deckId));
}

/*
 * played / won / win rate, who it beats, who beats it, and when it last hit
 * the table. `opponents` only counts seats that actually named a deck — an
 * unnamed seat is a person, not a matchup.
 */
export function deckRecord(games, deckId) {
  const played = gamesForDeck(games, deckId);
  let won = 0;
  const opponents = {};
  played.forEach((g) => {
    const mine = (g.seats || []).find((s) => s.deckId === deckId);
    const iWon = !!mine?.won;
    if (iWon) won += 1;
    (g.seats || []).forEach((s) => {
      if (s.deckId === deckId || !s.deckName) return;
      const key = s.deckId || `name:${s.deckName.toLowerCase()}`;
      const o = (opponents[key] = opponents[key] || { name: s.deckName, deckId: s.deckId, met: 0, beat: 0, lostTo: 0 });
      o.met += 1;
      if (iWon) o.beat += 1;
      else if (s.won) o.lostTo += 1;
    });
  });
  const lost = played.length - won;
  return {
    played: played.length,
    won,
    lost,
    // Null rather than zero when nothing's been played: "0%" reads like a
    // deck that keeps losing, which isn't the same statement as "never sleeved".
    winRate: played.length ? won / played.length : null,
    lastPlayed: played.length ? Math.max(...played.map((g) => g.at || 0)) : null,
    opponents: Object.values(opponents).sort((a, b) => b.met - a.met || a.name.localeCompare(b.name)),
    recent: played.slice(0, 8),
  };
}

// One line per deck for the deck list, without walking the games list once per
// deck: a single pass, then a lookup.
export function recordsByDeck(games) {
  const out = {};
  (games || []).forEach((g) => {
    (g.seats || []).forEach((s) => {
      if (!s.deckId) return;
      const r = (out[s.deckId] = out[s.deckId] || { played: 0, won: 0 });
      r.played += 1;
      if (s.won) r.won += 1;
    });
  });
  return out;
}

export function formatRecord(rec) {
  if (!rec || !rec.played) return null;
  const pct = Math.round((rec.won / rec.played) * 100);
  return `${rec.won}–${rec.played - rec.won} · ${pct}%`;
}

// Newest first, capped: a life counter can produce a lot of games, and the
// vault is one JSON blob.
export const MAX_GAMES = 400;

export function addGame(games, game) {
  return [game, ...(games || [])].slice(0, MAX_GAMES);
}
