#!/usr/bin/env node
// Enforces the Starnet fork rule: NO edits to Paperclip core except the single approved
// streaming patch (P-0, STARNET_PATCHES.md). Starnet work may only ADD files in
// Starnet-owned paths. Compares HEAD with its merge-base against upstream master:
//   - every changed file must be Starnet-owned, pnpm-lock.yaml, or in APPROVED_CORE_FILES
//   - every approved core file must be listed in STARNET_PATCHES.md
// Usage: node packages/starnet-devkit/scripts/core-diff-check.mjs [--against <ref>]  (default upstream/master)
// Extending APPROVED_CORE_FILES requires the user's explicit approval (see STARNET_PATCHES.md).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).trim();

export const STARNET_OWNED = [
  /^packages\/plugins\/starnet-/,
  /^packages\/adapters\/starnet-/,
  /^packages\/starnet-/,
  /^\.github\/workflows\/starnet-[^/]+\.ya?ml$/,
  /^STARNET_PATCHES\.md$/,
];
const GENERATED = [/^pnpm-lock\.yaml$/];
/** P-0 (plugin stream bridge) — the only approved core patch. */
export const APPROVED_CORE_FILES = [
  "server/src/app.ts",
  "server/src/services/plugin-loader.ts",
  "server/src/services/plugin-stream-bus.ts",
  "server/src/__tests__/plugin-stream-bridge.test.ts",
];

const i = process.argv.indexOf("--against");
const ref = i > 0 ? process.argv[i + 1] : "upstream/master";
let base;
try { base = git("merge-base", "HEAD", ref); } catch {
  console.error(`✗ cannot resolve ${ref}; fetch upstream first (git fetch upstream master, or in CI: git fetch https://github.com/paperclipai/paperclip.git master and pass --against FETCH_HEAD)`);
  process.exit(2);
}
const changed = git("diff", "--name-only", base, "HEAD").split("\n").filter(Boolean);
const doc = readFileSync(join(root, "STARNET_PATCHES.md"), "utf8");
const errors = [];
const core = changed.filter((f) => !STARNET_OWNED.some((r) => r.test(f)) && !GENERATED.some((r) => r.test(f)));
for (const f of core) {
  if (!APPROVED_CORE_FILES.includes(f)) errors.push(`core file changed without approval (only P-0 is allowed): ${f}`);
  else if (!doc.includes(f)) errors.push(`approved core file not documented in STARNET_PATCHES.md: ${f}`);
}
console.log(`vs ${ref} (merge-base ${base.slice(0, 10)}): ${changed.length} file(s) changed, ${core.length} core: ${core.join(", ") || "none"}`);
if (errors.length) { for (const e of errors) console.error(`✗ ${e}`); process.exit(1); }
console.log("✓ no core edits beyond the approved P-0 streaming patch");
