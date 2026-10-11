/*
 * Finished Life Counter games, shared with the server so the stats can cover
 * everyone who plays on it, not just this device.
 *
 * Nothing here is allowed to get in the way of a game: every call swallows its
 * failures and says "not now" instead. A game that couldn't be sent stays marked
 * as unsent on the device and goes up with the next one.
 */
import { apiCredentials, apiUrl, authHeaders } from "../../lib/platform";
import { loadGames, markGamesSynced } from "./lifeState";

const headers = () => ({ "Content-Type": "application/json", "x-hk-app": "1", ...authHeaders() });

// Send whatever this device has finished but not yet delivered.
export async function pushGames() {
  const pending = loadGames().filter((g) => !g.synced);
  if (!pending.length) return true;
  try {
    for (let i = 0; i < pending.length; i += 50) {
      const chunk = pending.slice(i, i + 50);
      const res = await fetch(apiUrl("/api/life/games"), {
        method: "POST",
        credentials: apiCredentials(),
        headers: headers(),
        body: JSON.stringify({ games: chunk }),
      });
      if (!res.ok) return false;
      markGamesSynced(chunk.map((g) => g.id));
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Every game on the server, newest first — or null when it can't be had
// (signed out, local-only phone app, server unreachable).
export async function fetchServerGames() {
  try {
    const res = await fetch(apiUrl("/api/life/games"), { credentials: apiCredentials(), headers: authHeaders() });
    if (!res.ok) return null;
    const d = await res.json();
    return Array.isArray(d.games) ? d.games : null;
  } catch (e) {
    return null;
  }
}
