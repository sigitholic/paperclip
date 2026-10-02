// Shared pieces of the model-tier scripts (check:models, apply-tier).
import { MODEL_TIERS } from "../../plugins/starnet-pack-kit/src/model-tiers.ts";

export function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

export const list = (s) => s?.split(",").map((m) => m.trim()).filter(Boolean);

export function parseTiers(spec) {
  if (!spec) return null;
  const pairs = Object.fromEntries(list(spec).map((p) => p.split("=").map((x) => x.trim())));
  const missing = MODEL_TIERS.filter((t) => !pairs[t]);
  if (missing.length) throw new Error(`--tiers is missing ${missing.join(", ")} (format: fast=a,standard=b,reasoning=c)`);
  return Object.fromEntries(MODEL_TIERS.map((t) => [t, pairs[t]]));
}

export async function findCompany(api, name) {
  const company = (await api.get("/companies")).find((c) => c.name === name || c.issuePrefix === name || c.id === name);
  if (!company) throw new Error(`company "${name}" not found`);
  return company;
}

async function listSecrets(api, companyId) {
  const secrets = await api.get(`/companies/${companyId}/secrets`);
  return Array.isArray(secrets) ? secrets : secrets.secrets ?? secrets.items ?? [];
}

export async function findSecretId(api, companyId, name) {
  return (await listSecrets(api, companyId)).find((s) => s.name === name)?.id ?? null;
}

/** Create the company secret, or rotate it when it exists. Returns the secret id. */
export async function upsertSecret(api, companyId, name, value) {
  const existing = (await listSecrets(api, companyId)).find((s) => s.name === name);
  if (existing) {
    await api.post(`/secrets/${existing.id}/rotate`, { value });
    return existing.id;
  }
  const created = await api.post(`/companies/${companyId}/secrets`, { name, value, description: "9router API key for Starnet agents (@starnet/devkit)" });
  return created.id;
}
