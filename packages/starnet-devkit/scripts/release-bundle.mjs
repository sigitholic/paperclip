#!/usr/bin/env node
// Build the prebuilt Starnet bundle used by the light Windows installer (packages/starnet-installer/install.ps1):
//   plugins/<dir>/      built plugin packages (package.json + dist + runtime files), installed via POST /api/plugins/install
//   adapter-9router/    the starnet_9router adapter bundled to one ESM file; npm deps are installed on the target PC
//   bundle.json         versions, including the pinned npm `paperclipai` release the bundle was tested against
// Plugins must be built first: pnpm --filter "./packages/plugins/starnet-*" build
// Usage: node packages/starnet-devkit/scripts/release-bundle.mjs [--out <dir>]
import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGINS } from "./demo-seed.mjs";

export const PAPERCLIP_NPM_VERSION = "2026.1001.0";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ADAPTER_DIR = join(REPO, "packages/adapters/starnet-9router");
const PLUGIN_RUNTIME_FILES = ["dist", "agent", "migrations", "README.md"];
const ADAPTER_EXTERNALS = ["@paperclipai/adapter-codex-local", "@paperclipai/adapter-utils", "@openai/codex"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function copyPlugin(key, rel, outDir) {
  const src = join(REPO, rel);
  if (!existsSync(join(src, "dist", "manifest.js"))) throw new Error(`${key} is not built; run: pnpm --filter ./${rel} build`);
  const dest = join(outDir, "plugins", basename(rel));
  mkdirSync(dest, { recursive: true });
  const pkg = readJson(join(src, "package.json"));
  const { name, version, type, description, license, paperclipPlugin } = pkg;
  writeFileSync(join(dest, "package.json"), `${JSON.stringify({ name, version, type, description, license, paperclipPlugin }, null, 2)}\n`);
  for (const entry of PLUGIN_RUNTIME_FILES) {
    if (existsSync(join(src, entry))) cpSync(join(src, entry), join(dest, entry), { recursive: true, filter: (p) => !p.endsWith(".map") });
  }
  return { key, dir: `plugins/${basename(rel)}`, name, version };
}

async function buildAdapter(outDir) {
  const pkg = readJson(join(ADAPTER_DIR, "package.json"));
  const dest = join(outDir, "adapter-9router");
  await esbuild.build({
    entryPoints: [join(ADAPTER_DIR, "src/index.ts")],
    outfile: join(dest, "dist/index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: ADAPTER_EXTERNALS.flatMap((dep) => [dep, `${dep}/*`]),
    logLevel: "warning",
  });
  const dependencies = {
    "@openai/codex": pkg.dependencies["@openai/codex"],
    "@paperclipai/adapter-codex-local": PAPERCLIP_NPM_VERSION,
    "@paperclipai/adapter-utils": PAPERCLIP_NPM_VERSION,
  };
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    type: "module",
    private: true,
    description: pkg.description,
    license: pkg.license,
    exports: { ".": "./dist/index.js" },
    dependencies,
    engines: pkg.engines,
  };
  writeFileSync(join(dest, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir: "adapter-9router", name: pkg.name, version: pkg.version, type: "starnet_9router" };
}

export async function buildBundle(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const plugins = Object.entries(PLUGINS).map(([key, rel]) => copyPlugin(key, rel, outDir));
  const adapter = await buildAdapter(outDir);
  const bundle = {
    schemaVersion: 1,
    commit: gitCommit(),
    builtAt: new Date().toISOString(),
    paperclipVersion: PAPERCLIP_NPM_VERSION,
    plugins,
    adapter,
  };
  writeFileSync(join(outDir, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
  return bundle;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const outDir = resolve(i > 0 ? process.argv[i + 1] : join(REPO, "dist/starnet-bundle"));
  buildBundle(outDir)
    .then((b) => console.log(`starnet bundle ${b.commit} (paperclipai ${b.paperclipVersion}): ${b.plugins.length} plugins + ${b.adapter.name} -> ${outDir}`))
    .catch((err) => { console.error(`release-bundle failed: ${err.message}`); process.exit(1); });
}
