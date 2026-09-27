#!/usr/bin/env node
// Keeps STARNET_PATCHES.md honest.
//  1. Every `STARNET-PATCH P-n` marker in non-Starnet (core) files must have a `| P-n |` row
//     in the "Core patches" table, and every row must have at least one marker.
//  2. With `--against <ref>` (e.g. upstream/master), every file changed vs. the merge-base
//     outside Starnet-owned paths must be mentioned in STARNET_PATCHES.md.
// Usage: node packages/starnet-devkit/scripts/patch-markers.mjs [--against upstream/master]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });

export const STARNET_OWNED = [
  /^packages\/plugins\/starnet-/,
  /^packages\/starnet-/,
  /^packages\/adapters\/starnet-/,
  /^\.github\/workflows\/starnet-/,
  /^STARNET_PATCHES\.md$/,
];
// Generated/infra files that change with every Starnet package but are not core patches.
const ALLOWED_NON_PATCH = [/^pnpm-lock\.yaml$/];
const isStarnet = (f) => STARNET_OWNED.some((r) => r.test(f));

const doc = readFileSync(join(root, "STARNET_PATCHES.md"), "utf8");
const rows = new Set([...doc.matchAll(/^\|\s*(P-\d+)\s*\|/gm)].map((m) => m[1]));

const markers = new Map(); // id -> [file:line]
const hits = (() => {
  try { return git("grep", "-n", "-E", "STARNET-PATCH P-[0-9]+", "--", "."); } catch { return ""; }
})();
for (const line of hits.split("\n").filter(Boolean)) {
  const [file, lineNo] = line.split(":", 2);
  if (isStarnet(file)) continue;
  for (const m of line.matchAll(/STARNET-PATCH (P-\d+)/g)) {
    if (!markers.has(m[1])) markers.set(m[1], []);
    markers.get(m[1]).push(`${file}:${lineNo}`);
  }
}

const errors = [];
for (const [id, where] of markers) if (!rows.has(id)) errors.push(`marker ${id} (${where.join(", ")}) has no row in STARNET_PATCHES.md`);
for (const id of rows) if (!markers.has(id)) errors.push(`STARNET_PATCHES.md row ${id} has no STARNET-PATCH ${id} marker in the code`);

const i = process.argv.indexOf("--against");
if (i > 0) {
  const ref = process.argv[i + 1];
  const base = git("merge-base", "HEAD", ref).trim();
  const changed = git("diff", "--name-only", base, "HEAD").split("\n").filter(Boolean);
  const core = changed.filter((f) => !isStarnet(f) && !ALLOWED_NON_PATCH.some((r) => r.test(f)));
  for (const f of core) if (!doc.includes(f)) errors.push(`core file changed vs ${ref} but not listed in STARNET_PATCHES.md: ${f}`);
  console.log(`core files changed vs ${ref} (merge-base ${base.slice(0, 9)}): ${core.length ? core.join(", ") : "none"}`);
}

for (const [id, where] of [...markers].sort()) console.log(`${id}: ${where.length} marker(s) — ${where.join(", ")}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ STARNET_PATCHES.md matches code (${rows.size} core patch(es))`);
