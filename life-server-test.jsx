// Finished Life Counter games shared across the server: only for signed-in
// accounts, validated, de-duplicated, and readable by every account.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}
function call(port, method, p, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload !== undefined) {
      h["Content-Type"] = "application/json";
      h["Content-Length"] = Buffer.byteLength(payload);
    }
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: h }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    r.on("error", reject);
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}
const APP = { "x-hk-app": "1" };
const cookieOf = (res) => (res.headers["set-cookie"] || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("bw_session=")) || null;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-life-"));
const port = 27000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server.cjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATA_DIR: dir, CARD_DB: "off", AUTH_MODE: "accounts" },
  stdio: ["ignore", "ignore", "pipe"],
});
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try { if ((await call(port, "GET", "/api/health")).status === 200) break; } catch (e) {}
}

const game = (id, at, win, names) => ({
  id, at, format: "commander",
  seats: names.map(([name, commander]) => ({ name, commander, won: name === win })),
});

try {
  const mike = cookieOf(await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "mike@example.com", password: "a long enough password" } }));
  const eva = cookieOf(await call(port, "POST", "/api/auth/register", { headers: APP, body: { email: "eva@example.com", password: "a long enough password" } }));
  check("two accounts exist", !!mike && !!eva);

  check("reading the games needs a sign-in", (await call(port, "GET", "/api/life/games")).status === 401);
  check("sending a game needs a sign-in", (await call(port, "POST", "/api/life/games", { headers: APP, body: { games: [] } })).status === 401);
  check("a cookie write without the app header is refused (CSRF)", (await call(port, "POST", "/api/life/games", { cookie: mike, body: { games: [] } })).status === 403);

  const g1 = game("g-1-aaaa", Date.now() - 5000, "Mike", [["Mike", "Meren"], ["Eva", "Atraxa"]]);
  const post = await call(port, "POST", "/api/life/games", { headers: APP, cookie: mike, body: { games: [g1] } });
  check("a signed-in account can add a finished game", post.status === 200 && post.json?.stored === 1);
  const again = await call(port, "POST", "/api/life/games", { headers: APP, cookie: mike, body: { games: [g1] } });
  check("sending the same game again stores nothing new", again.status === 200 && again.json?.stored === 0);

  const g2 = game("g-2-bbbb", Date.now() - 1000, "Eva", [["Mike", "Meren"], ["Eva", "Atraxa"], ["Player 3", null]]);
  await call(port, "POST", "/api/life/games", { headers: APP, cookie: eva, body: { games: [g2] } });
  const read = await call(port, "GET", "/api/life/games", { cookie: mike });
  check("every account sees every account's games, newest first", read.status === 200 && read.json.games.length === 2 && read.json.games[0].id === "g-2-bbbb" && read.json.games[1].id === "g-1-aaaa");
  check("a game comes back with its winner, seats and commanders", read.json.games[1].winnerName === "Mike" && read.json.games[1].seats[1].commander === "Atraxa" && read.json.games[1].format === "commander");
  check("and nobody's account is in it", !JSON.stringify(read.json).includes("mike@example.com") && !("user_id" in read.json.games[0]) && !("userId" in read.json.games[0]));

  const bad = await call(port, "POST", "/api/life/games", {
    headers: APP, cookie: mike,
    body: { games: [
      { id: "x", at: Date.now(), seats: [{ name: "A", won: true }] },                                   // one seat
      game("two-winners", Date.now(), "A", [["A", null], ["A", null]]),                                  // two winners
      { ...game("no-winner", Date.now(), "Z", [["A", null], ["B", null]]) },                              // nobody won
      { ...game("bad id!", Date.now(), "A", [["A", null], ["B", null]]) },
      { ...game("future", Date.now() + 10 * 86400000, "A", [["A", null], ["B", null]]) },
      { ...game("noname", Date.now(), "A", [["A", null], ["", null]]) },
      "junk", null,
    ] },
  });
  check("malformed games are skipped, not stored", bad.status === 200 && bad.json?.stored === 0);

  const long = "x".repeat(300);
  await call(port, "POST", "/api/life/games", { headers: APP, cookie: mike, body: { games: [game("long-1", Date.now(), long, [[long, long], ["B", null]])] } });
  const after = await call(port, "GET", "/api/life/games", { cookie: mike });
  const stored = after.json.games.find((g) => g.id === "long-1");
  check("over-long names are cut down", !!stored && stored.seats[0].name.length === 60 && stored.seats[0].commander.length === 60);

  const many = Array.from({ length: 80 }, (_, i) => game(`bulk-${i}`, Date.now() - i, "A", [["A", null], ["B", null]]));
  const bulk = await call(port, "POST", "/api/life/games", { headers: APP, cookie: mike, body: { games: many } });
  check("at most 50 games are taken in one request", bulk.json?.stored === 50);
} finally {
  child.kill();
}
console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
