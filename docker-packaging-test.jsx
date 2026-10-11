// Verifies: the Docker image actually contains what the app needs to run.
//
// This exists because it didn't. server.cjs grew a `require("./public-vault.cjs")`
// and the Dockerfile still listed its server modules by name, so the image
// built cleanly and then crash-looped on MODULE_NOT_FOUND — code correct,
// packaging wrong, and nothing in the test suite could tell. These checks read
// the real Dockerfile and the real source, so they fail the moment the two
// disagree again.
import { readFileSync, readdirSync, existsSync } from "node:fs";

let ok = true;
function check(label, cond) {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) ok = false;
}

const dockerfile = readFileSync("Dockerfile", "utf8");
// Lines that copy from the build context (not `COPY --from=build`).
const copyLines = dockerfile
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("COPY ") && !l.includes("--from="))
  .map((l) => l.replace(/^COPY\s+/, ""));
const copiedTokens = copyLines.flatMap((l) => l.split(/\s+/).slice(0, -1));

function isCopied(file) {
  return copiedTokens.some((t) => {
    if (t === file) return true;
    if (t === "." || t === "./") return true;
    if (t.includes("*")) {
      const re = new RegExp(`^${t.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      return re.test(file);
    }
    return false;
  });
}

// ---- every server-side module server.cjs requires must be in the image ----
const server = readFileSync("server.cjs", "utf8");
const required = [...server.matchAll(/require\(["']\.\/([^"']+)["']\)/g)].map((m) => m[1]);
check("server.cjs requires at least one local module", required.length > 0);
required.forEach((mod) => {
  check(`server.cjs requires ./${mod} — and the Dockerfile copies it`, isCopied(mod));
  check(`...and ./${mod} exists in the repo`, existsSync(mod));
});

// ---- and the reverse: no root .cjs is left out of the image ----
const rootCjs = readdirSync(".").filter((f) => f.endsWith(".cjs"));
rootCjs.forEach((f) => check(`${f} is copied into the image`, isCopied(f)));

// ---- the build stage needs everything vite reads ----
check("the build copies index.html", isCopied("index.html"));
check("the build copies vite.config.js", isCopied("vite.config.js"));
check("the build copies src", isCopied("src"));
check(
  "the build copies public/ — vite serves it verbatim, and the card scanner's wasm lives there",
  !existsSync("public") || isCopied("public")
);

// ---- the entry point is what the image runs ----
// Local-folder dependencies (the phone app's native plugin) have to be in the
// image before `npm ci`, or the whole build fails at the install step.
{
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const localDeps = Object.values({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter((v) => typeof v === "string" && v.startsWith("file:"))
    .map((v) => v.slice(5).replace(/\/$/, ""));
  const ciAt = dockerfile.indexOf("RUN npm ci");
  const beforeCi = dockerfile.slice(0, ciAt);
  localDeps.forEach((dir) => {
    check(`${dir}/package.json is copied before npm ci`, beforeCi.includes(`${dir}/package.json`));
    const entry = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")).main || "index.js";
    check(`${dir}/${entry} is copied before npm ci`, beforeCi.includes(`${dir}/${entry}`));
  });
}
check("the image runs server.cjs", /CMD\s+\[\s*"node",\s*"server\.cjs"\s*\]/.test(dockerfile));
check("the data volume is declared", /VOLUME\s+\/data/.test(dockerfile));
check("the port the compose file maps is the port the image exposes", (() => {
  if (!existsSync("docker-compose.yml")) return true;
  const compose = readFileSync("docker-compose.yml", "utf8");
  const exposed = dockerfile.match(/EXPOSE\s+(\d+)/)?.[1];
  const mapped = compose.match(/"(\d+):(\d+)"/);
  return !exposed || !mapped || mapped[2] === exposed;
})());

// ---- .dockerignore must not exclude anything the image needs ----
if (existsSync(".dockerignore")) {
  const ignored = readFileSync(".dockerignore", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  check("nothing the server requires is in .dockerignore", !ignored.some((pat) => required.includes(pat) || pat.endsWith(".cjs")));
  check("src and public aren't ignored", !ignored.includes("src") && !ignored.includes("public"));
}

console.log(ok ? "\nALL PASS" : "\nFAIL");
process.exit(ok ? 0 : 1);
