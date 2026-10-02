#!/usr/bin/env node
// Prove which models the signed-in account (or an OpenAI-compatible gateway such as 9router) can
// actually run through codex_local, then check the Starnet tier map.
//
// The adapter's test-environment endpoint skips its hello probe on the ACP engine, so this does a
// real one-line run per model: a temporary probe agent gets an issue "reply OK"; failures are
// explained from Codex's own log (the run itself only says "terminal service failure").
// Each probe spends a small amount of quota; nothing runs and nothing is written without --yes.
//
// Usage (ChatGPT login, default):
//   node packages/starnet-devkit/scripts/model-tiers-check.mjs --company "Starnet Demo" [--yes]
//     [--models gpt-6-luna,gpt-5.5] [--timeout 180]
// Usage (9router gateway; the key is read from a local env var and stored as a company secret):
//   NINEROUTER_API_KEY=... node packages/starnet-devkit/scripts/model-tiers-check.mjs --provider 9router \
//     --base-url https://my-tunnel.example.com --company "Starnet Demo" \
//     [--tiers fast=kr/glm-5,standard=my-combo,reasoning=cc/claude-opus-4-7] [--models a,b] [--yes]
// Exit code 1 when any tier-map model fails. Talks REST to a local Paperclip instance only.
import { client } from "../lib/api.mjs";
import { classifyFailure, codexHomeFor, listedCodexModels, readCodexFailure } from "../lib/model-probe.mjs";
import {
  codexGatewayEnv,
  DEFAULT_CODEX_TIERS,
  MODEL_TIERS,
  NINEROUTER_ENV_KEY,
  ninerouterTiers,
  normalizeBaseUrl,
} from "../../plugins/starnet-pack-kit/src/model-tiers.ts";

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const NINEROUTER_SECRET_NAME = "starnet-9router-api-key";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const list = (s) => s?.split(",").map((m) => m.trim()).filter(Boolean);

export function parseTiers(spec) {
  if (!spec) return null;
  const pairs = Object.fromEntries(list(spec).map((p) => p.split("=").map((x) => x.trim())));
  const missing = MODEL_TIERS.filter((t) => !pairs[t]);
  if (missing.length) throw new Error(`--tiers is missing ${missing.join(", ")} (format: fast=a,standard=b,reasoning=c)`);
  return Object.fromEntries(MODEL_TIERS.map((t) => [t, pairs[t]]));
}

async function findCompany(api, name) {
  const company = (await api.get("/companies")).find((c) => c.name === name || c.issuePrefix === name || c.id === name);
  if (!company) throw new Error(`company "${name}" not found`);
  return company;
}

/** Read-only connectivity check against the gateway; costs no quota. */
export async function listGatewayModels(baseUrl, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`GET ${baseUrl}/models -> ${res.status}`);
  const body = await res.json();
  return (body.data ?? body.models ?? []).map((m) => m.id ?? m.name).filter(Boolean);
}

async function upsertSecret(api, companyId, name, value) {
  const secrets = await api.get(`/companies/${companyId}/secrets`);
  const existing = (Array.isArray(secrets) ? secrets : secrets.secrets ?? secrets.items ?? []).find((s) => s.name === name);
  if (existing) {
    await api.post(`/secrets/${existing.id}/rotate`, { value });
    return existing.id;
  }
  const created = await api.post(`/companies/${companyId}/secrets`, { name, value, description: "9router API key for Starnet codex_local agents (@starnet/devkit)" });
  return created.id;
}

async function findSecretId(api, companyId, name) {
  const secrets = await api.get(`/companies/${companyId}/secrets`);
  return (Array.isArray(secrets) ? secrets : secrets.secrets ?? secrets.items ?? []).find((s) => s.name === name)?.id ?? null;
}

async function waitForRun(api, issueId, timeoutMs) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    const runs = await api.get(`/issues/${issueId}/runs`);
    last = runs[0];
    const done = runs.find((r) => TERMINAL.has(r.status));
    if (done) return done;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { status: "probe_timeout", runId: last?.runId };
}

async function probeModel(api, { companyId, agentId, model, adapterConfigFor, timeoutMs, codexHome }) {
  const startedAt = Date.now();
  await api.patch(`/agents/${agentId}`, { adapterConfig: adapterConfigFor(model) });
  const issue = await api.post(`/companies/${companyId}/issues`, {
    title: `[model-probe] ${model}`,
    description: "Model availability probe. Reply with exactly: OK. Then mark this issue done. Do not use tools.",
    assigneeAgentId: agentId,
    status: "todo",
  });
  const run = await waitForRun(api, issue.id, timeoutMs);
  const ok = run.status === "succeeded";
  if (!ok) await api.patch(`/issues/${issue.id}`, { status: "cancelled" }).catch(() => undefined);
  const detail = ok ? null : readCodexFailure(codexHome, model, startedAt);
  return { model, ok, status: run.status, reason: ok ? "ok" : classifyFailure(detail), detail, issue: issue.identifier, seconds: Math.round((Date.now() - startedAt) / 1000) };
}

export async function checkModelTiers({
  companyName,
  provider = "chatgpt",
  baseUrl,
  apiKey,
  tiers,
  models,
  timeoutMs = 180_000,
  yes = false,
  log = console.log,
}) {
  const api = client();
  if (!(await api.healthy())) throw new Error(`Paperclip is not reachable at ${api.base}`);
  const company = await findCompany(api, companyName);
  const codexHome = codexHomeFor(company.id);

  let tierMap = DEFAULT_CODEX_TIERS;
  let listed = listedCodexModels(codexHome);
  let gatewayEnv = () => ({});
  if (provider === "9router") {
    if (!baseUrl) throw new Error("--base-url is required for --provider 9router");
    const url = normalizeBaseUrl(baseUrl);
    tierMap = tiers ? ninerouterTiers({ baseUrl: url, models: tiers }) : null;
    if (apiKey) {
      listed = await listGatewayModels(url, apiKey);
      log(`9router at ${url}: ${listed.length} models/combos available`);
    } else {
      listed = [];
      log(`9router at ${url}: ${NINEROUTER_ENV_KEY} not set locally, skipping the model list check`);
    }
    gatewayEnv = (secretId) => codexGatewayEnv({ id: "ninerouter", name: "9router", baseUrl: url, envKey: NINEROUTER_ENV_KEY }, { type: "secret_ref", secretId });
  } else if (provider !== "chatgpt") {
    throw new Error(`unknown --provider ${provider} (chatgpt | 9router)`);
  }

  const tierModels = tierMap ? [...new Set(MODEL_TIERS.map((t) => tierMap.tiers[t].model))] : [];
  const candidates = models?.length ? [...new Set([...tierModels, ...models])] : tierModels.length || provider === "chatgpt" ? [...new Set([...tierModels, ...listed])] : [];
  if (!candidates.length) {
    log(`nothing to probe. Pick models with --models or --tiers. Available: ${listed.slice(0, 40).join(", ")}${listed.length > 40 ? ", ..." : ""}`);
    return { results: [], tierFailures: [] };
  }
  const unknown = listed.length ? candidates.filter((m) => !listed.includes(m)) : [];
  if (unknown.length) log(`warning: not advertised by the provider: ${unknown.join(", ")}`);

  log(`company ${company.name} (${company.issuePrefix}); provider ${provider}; models to probe: ${candidates.join(", ")}`);
  if (!yes) {
    log("dry run: each probe is one real run and spends quota. Re-run with --yes to probe.");
    return { results: [], tierFailures: [] };
  }

  let secretId = null;
  if (provider === "9router") {
    secretId = apiKey ? await upsertSecret(api, company.id, NINEROUTER_SECRET_NAME, apiKey) : await findSecretId(api, company.id, NINEROUTER_SECRET_NAME);
    if (!secretId) throw new Error(`set ${NINEROUTER_ENV_KEY} once so the key can be stored as company secret "${NINEROUTER_SECRET_NAME}"`);
  }
  const adapterConfigFor = (model) => (provider === "9router" ? { model, env: gatewayEnv(secretId) } : { model });

  const probeName = provider === "9router" ? "Starnet Model Probe (9router)" : "Starnet Model Probe";
  const agents = await api.get(`/companies/${company.id}/agents`);
  let probe = agents.find((a) => a.name === probeName && a.status !== "terminated");
  probe ??= await api.post(`/companies/${company.id}/agents`, {
    name: probeName,
    role: "general",
    title: "Temporary model availability probe (@starnet/devkit)",
    adapterType: "codex_local",
    adapterConfig: adapterConfigFor(candidates[0]),
  });
  if (probe.status === "paused") await api.post(`/agents/${probe.id}/resume`, {});

  const results = [];
  try {
    for (const model of candidates) {
      log(`probing ${model} ...`);
      const r = await probeModel(api, { companyId: company.id, agentId: probe.id, model, adapterConfigFor, timeoutMs, codexHome });
      log(`  ${r.ok ? "PASS" : "FAIL"} ${model} (${r.status}, ${r.reason}, ${r.seconds}s, ${r.issue})${r.detail ? `\n    ${r.detail}` : ""}`);
      results.push(r);
    }
  } finally {
    await api.post(`/agents/${probe.id}/pause`, {}).catch((err) => log(`warning: could not pause probe agent: ${err.message}`));
  }

  if (!tierMap) return { results, tierFailures: [] };
  const passed = new Set(results.filter((r) => r.ok).map((r) => r.model));
  const tierFailures = MODEL_TIERS.filter((t) => !passed.has(tierMap.tiers[t].model));
  log(`\ntier map (${provider === "9router" ? "ninerouterTiers --tiers" : "pack-kit DEFAULT_CODEX_TIERS"}):`);
  for (const t of MODEL_TIERS) {
    const c = tierMap.tiers[t];
    log(`  ${t.padEnd(9)} ${c.model}${c.reasoningEffort ? ` / ${c.reasoningEffort}` : ""}  ${passed.has(c.model) ? "ok" : "NOT AVAILABLE"}`);
  }
  return { results, tierFailures };
}

if (process.argv[1]?.endsWith("model-tiers-check.mjs")) {
  const provider = arg("--provider", "chatgpt");
  checkModelTiers({
    companyName: arg("--company", "Starnet Demo"),
    provider,
    baseUrl: arg("--base-url", process.env.NINEROUTER_BASE_URL),
    apiKey: provider === "9router" ? process.env[NINEROUTER_ENV_KEY]?.trim() || undefined : undefined,
    tiers: parseTiers(arg("--tiers")),
    models: list(arg("--models")),
    timeoutMs: Number(arg("--timeout", "180")) * 1000,
    yes: process.argv.includes("--yes"),
  })
    .then(({ tierFailures }) => { process.exitCode = tierFailures.length ? 1 : 0; })
    .catch((err) => { console.error(err.message); process.exitCode = 1; });
}
