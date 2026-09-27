// Devkit state (ids of the seeded demo company). Lives in packages/starnet-devkit/.state/
// (gitignored). File mode 0600 because live mode keeps the fake-device password here.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STATE_FILE = process.env.STARNET_DEVKIT_STATE ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".state", "demo.json");
export const readState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : null);
export function writeState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  chmodSync(STATE_FILE, 0o600);
}
