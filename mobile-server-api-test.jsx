// Verifies the two server changes the phone app depends on (server.cjs):
//
//  1. CORS — the Android/iOS app's pages come from https://localhost or
//     capacitor://localhost, not from the server, so /api/* must answer those
//     origins (preflight included) and stay silent for anyone else.
//  2. Save revisions — every save sends the whole vault, so a device that
//     loaded revision N must be refused (409) once someone else has saved
//     N+1, instead of silently overwriting their edits. Saves without the
//     header (old tabs) keep working as before.
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

// node's fetch won't reliably send a custom Origin, so talk raw http.
function req(port, method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.write(typeof body === "string" ? body : JSON.stringify(body));
    r.end();
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bw-mobile-"));
const port = 20000 + Math.floor(Math.random() * 2000);
const child = spawn(process.execPath, ["server.cjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), DATA_DIR: tmp, CARD_DB: "off", CORS_ORIGINS: "http://localhost:5173" },
  stdio: "ignore",
});

try {
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      up = (await req(port, "GET", "/api/health")).status === 200;
    } catch (e) {}
  }
  check("server starts", up);

  // ---- CORS ----
  const android = await req(port, "GET", "/api/health", { Origin: "https://localhost" });
  check("Android WebView origin is allowed", android.headers["access-control-allow-origin"] === "https://localhost");
  check("…and the answer varies by Origin", /origin/i.test(android.headers["vary"] || ""));
  const ios = await req(port, "OPTIONS", "/api/store", {
    Origin: "capacitor://localhost",
    "Access-Control-Request-Method": "PUT",
    "Access-Control-Request-Headers": "content-type,authorization,x-base-rev",
  });
  check("iOS preflight gets 204", ios.status === 204);
  check("preflight allows PUT", /PUT/.test(ios.headers["access-control-allow-methods"] || ""));
  const allowed = (ios.headers["access-control-allow-headers"] || "").toLowerCase();
  check("preflight allows the sign-in token and revision headers", allowed.includes("authorization") && allowed.includes("x-base-rev"));
  const extra = await req(port, "GET", "/api/health", { Origin: "http://localhost:5173" });
  check("CORS_ORIGINS adds more origins", extra.headers["access-control-allow-origin"] === "http://localhost:5173");
  const evil = await req(port, "GET", "/api/health", { Origin: "https://evil.example" });
  check("any other origin gets no CORS header", evil.headers["access-control-allow-origin"] === undefined);
  const plain = await req(port, "GET", "/api/health");
  check("same-origin requests are unchanged", plain.status === 200 && plain.json?.ok === true && !plain.headers["access-control-allow-origin"]);
  const staticPage = await req(port, "GET", "/", { Origin: "https://localhost" });
  check("static pages never get CORS headers", staticPage.headers["access-control-allow-origin"] === undefined);

  // ---- revisions ----
  const reg = await req(port, "POST", "/api/auth/register", { "Content-Type": "application/json", "x-hk-app": "1" }, { email: "michael@example.com", password: "a long enough password", app: true });
  const auth = { Authorization: `Bearer ${reg.json?.token}`, "Content-Type": "application/json" };
  check("an account to save into", !!reg.json?.token);
  const empty = await req(port, "GET", "/api/store", auth);
  check("a new vault starts at revision 0", empty.json?.rev === 0);
  const created = await req(port, "PUT", "/api/store", auth, { value: "v1" });
  check("the first save is revision 1", created.status === 200 && created.json?.rev === 1);

  const phone = await req(port, "GET", "/api/store", auth);
  const desktop = await req(port, "GET", "/api/store", auth);
  check("GET reports the revision", phone.json?.rev === 1 && phone.json?.value === "v1");

  const desktopSave = await req(port, "PUT", "/api/store", { ...auth, "x-base-rev": String(desktop.json.rev) }, { value: "desktop edit" });
  check("a save on top of the current revision succeeds", desktopSave.status === 200 && desktopSave.json?.rev === 2);

  const phoneSave = await req(port, "PUT", "/api/store", { ...auth, "x-base-rev": String(phone.json.rev) }, { value: "stale phone edit" });
  check("a save on top of an old revision is refused with 409", phoneSave.status === 409 && phoneSave.json?.rev === 2);
  const after = await req(port, "GET", "/api/store", auth);
  check("…and the other device's edit survives", after.json?.value === "desktop edit" && after.json?.rev === 2);

  const oldTab = await req(port, "PUT", "/api/store", auth, { value: "old tab" });
  check("a save without a revision (an old tab) still goes through", oldTab.status === 200 && oldTab.json?.rev === 3);
  const nobody = await req(port, "PUT", "/api/store", { "Content-Type": "application/json", "x-hk-app": "1" }, { value: "x" });
  check("saving needs a sign-in", nobody.status === 401);
} finally {
  child.kill();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) {}
}

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
