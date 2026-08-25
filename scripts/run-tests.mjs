#!/usr/bin/env node
// Runs every `*-test.jsx` smoke test in the repo root the same way SYNC.md's manual
// recipe does (esbuild-bundle each test with jsdom external, then run it under node),
// but loops all of them and prints one pass/fail summary instead of a one-off per file.
//
// Usage: node scripts/run-tests.mjs [pattern]
//   pattern (optional): only run test files whose name includes this substring.

import { build } from "esbuild";
import { spawn } from "node:child_process";
import { readdir, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filterArg = process.argv[2];

const allFiles = (await readdir(rootDir)).filter((f) => f.endsWith("-test.jsx"));
const files = (filterArg ? allFiles.filter((f) => f.includes(filterArg)) : allFiles).sort();

if (files.length === 0) {
  console.error(filterArg ? `No test files match "${filterArg}".` : "No *-test.jsx files found.");
  process.exit(1);
}

// Bundled output must live under rootDir so Node's module resolution still finds
// jsdom (and anything else marked --external) via the normal node_modules walk-up -
// a system tmpdir has no node_modules ancestor and every run would ERR_MODULE_NOT_FOUND.
const workDir = path.join(rootDir, "scripts", ".test-run-tmp");
await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
const results = [];

for (const file of files) {
  const entry = path.join(rootDir, file);
  const outfile = path.join(workDir, file.replace(/\.jsx$/, ".mjs"));
  const start = Date.now();
  let stdout = "";
  let stderr = "";
  let code = -1;

  try {
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      loader: { ".jsx": "jsx" },
      external: ["jsdom"],
      absWorkingDir: rootDir,
      logLevel: "silent",
    });

    code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [outfile], { cwd: rootDir });
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (c) => resolve(c ?? -1));
    });
  } catch (err) {
    stderr += String(err?.message || err);
  }

  const ms = Date.now() - start;
  const failLines = stdout.split("\n").filter((l) => l.startsWith("FAIL"));
  results.push({ file, ok: code === 0, ms, stdout, stderr, failLines });

  const status = code === 0 ? "PASS" : "FAIL";
  console.log(`${status}  ${file}  (${ms}ms)`);
  if (code !== 0) {
    for (const l of failLines) console.log(`       ${l}`);
    if (stderr.trim()) console.log(`       stderr: ${stderr.trim().split("\n").slice(0, 5).join("\n       ")}`);
    if (!failLines.length && !stderr.trim()) {
      // crashed before printing any FAIL lines (e.g. import error) - show a tail of stdout too
      const tail = stdout.trim().split("\n").slice(-5);
      for (const l of tail) console.log(`       ${l}`);
    }
  }
}

await rm(workDir, { recursive: true, force: true });

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log("");
console.log(`${passed}/${results.length} test files passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) {
  console.log("Failed: " + results.filter((r) => !r.ok).map((r) => r.file).join(", "));
}
process.exit(failed ? 1 : 0);
