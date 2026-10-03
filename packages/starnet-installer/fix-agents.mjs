// Starnet Office "Perbaiki Agent" (light install, copied to %LOCALAPPDATA%\StarnetOffice by install.ps1).
// Releases a stale AI connection binding (runtimeConfig.aiConnection) from agents, so an agent created with
// Codex/Claude + a ChatGPT/OpenAI account can be switched to an adapter without AI connections (starnet_9router).
// Paperclip has no UI or API to release it (STARNET_PATCHES.md, upstream candidate #12), so this edits only that one
// key in the instance database. Needs Starnet Office running (the embedded database lives with the server).
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_EMBEDDED_PORT = 54329;

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function databaseUrl() {
  const settings = readJson(join(ROOT, "settings.json"));
  if (settings?.databaseUrl) return settings.databaseUrl;
  const config = readJson(join(ROOT, "data", "instances", "default", "config.json"));
  if (config?.database?.mode === "postgres" && config.database.connectionString) return config.database.connectionString;
  const port = config?.database?.embeddedPostgresPort ?? DEFAULT_EMBEDDED_PORT;
  return `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
}

const require = createRequire(join(ROOT, "app", "package.json"));
const sql = require("postgres")(databaseUrl(), { max: 1, connect_timeout: 5, onnotice: () => {} });

async function ask(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } catch {
    return "";
  } finally {
    rl.close();
  }
}

async function main() {
  let rows;
  try {
    rows = await sql`
      select a.id, a.name, a.adapter_type, c.name as company, a.runtime_config->'aiConnection'->>'provider' as provider
      from agents a join companies c on c.id = a.company_id
      where a.runtime_config ? 'aiConnection' and a.status <> 'terminated'
      order by c.name, a.name`;
  } catch (err) {
    console.log(`Tidak bisa membuka database Starnet (${err.code ?? err.message}).`);
    console.log("Nyalakan Starnet Office dulu (dobel-klik 'Starnet Office'), lalu jalankan alat ini lagi.");
    return;
  }
  if (rows.length === 0) {
    console.log("Tidak ada agent yang terikat AI connection. Semua agent bisa diganti adapternya dari UI.");
    return;
  }
  console.log("Agent yang masih terikat akun AI (AI connection):\n");
  rows.forEach((r, i) => console.log(`  ${i + 1}. ${r.name}  [${r.company}]  adapter ${r.adapter_type}, akun ${r.provider ?? "?"}`));
  console.log("\nIkatan perlu dilepas sebelum agent diganti ke adapter tanpa AI connection (misalnya starnet_9router).");
  console.log("Setelah dilepas, agent Codex/Claude memakai login bawaan adapternya sampai akun dipilih lagi di UI.\n");
  const answer = (await ask("Nomor agent yang dilepas (pisahkan koma, 'semua', atau Enter untuk batal): ")).trim().toLowerCase();
  if (!answer) {
    console.log("Dibatalkan, tidak ada yang diubah.");
    return;
  }
  const picked = answer === "semua"
    ? rows
    : answer.split(",").map((s) => rows[Number(s.trim()) - 1]).filter(Boolean);
  if (picked.length === 0) {
    console.log("Nomor tidak dikenal, tidak ada yang diubah.");
    return;
  }
  for (const r of picked) {
    await sql`update agents set runtime_config = runtime_config - 'aiConnection', updated_at = now() where id = ${r.id}`;
    console.log(`  OK  ${r.name}: ikatan AI connection dilepas`);
  }
  console.log("\nSelesai. Di browser tekan F5, buka agent, ganti adapter, lalu Save dan Test.");
}

try {
  await main();
} finally {
  await sql.end({ timeout: 2 });
}
