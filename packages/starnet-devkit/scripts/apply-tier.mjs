#!/usr/bin/env node
// Resolve the model tier declared by Starnet agent templates (adapterConfig.starnetTier) against one
// company's tier map, and write the result into each agent's adapterConfig.
//
// Plugins cannot edit an agent's adapterConfig after creating it, so templates ship paused with only
// a tier; this script fills in model, gateway URL and the API key secret, then optionally resumes.
// Nothing is written without --yes.
//
// Usage (9router through the starnet_9router adapter; the key secret must exist or be given once):
//   [NINEROUTER_API_KEY=...] node packages/starnet-devkit/scripts/apply-tier.mjs --company "Starnet Demo" \
//     --base-url https://my-tunnel.example.com --tiers fast=a,standard=my-combo,reasoning=c \
//     [--secret ninerouter_api_key] [--agent "Kepala Kantor" --tier reasoning] [--resume] [--yes]
// Usage (ChatGPT login through codex_local, pack-kit DEFAULT_CODEX_TIERS):
//   node packages/starnet-devkit/scripts/apply-tier.mjs --provider chatgpt --company "Starnet Demo" [--yes]
import { client } from "../lib/api.mjs";
import { arg, findCompany, findSecretId, parseTiers, upsertSecret } from "../lib/tier-cli.mjs";
import { listGatewayModels, NINEROUTER_SECRET_NAME } from "./model-tiers-check.mjs";
import {
  declaredTier,
  DEFAULT_CODEX_TIERS,
  isModelTier,
  MODEL_TIERS,
  NINEROUTER_ADAPTER_TYPE,
  NINEROUTER_ENV_KEY,
  ninerouterTiers,
  TIER_CONFIG_KEY,
  tierAdapterConfig,
} from "../../plugins/starnet-pack-kit/src/model-tiers.ts";

// Adapter-neutral keys that survive an adapter switch (managed instructions bundle, run limits, env).
const PORTABLE_KEYS = ["instructionsFilePath", "instructionsBundleMode", "instructionsRootPath", "instructionsEntryFile", "timeoutSec", "env"];

/** The PATCH body that moves `agent` to `tier` of `map`. Pure; exported for tests. */
export function tierPatch(agent, tier, map, apiKey) {
  const current = agent.adapterConfig ?? {};
  const kept = agent.adapterType === map.adapterType ? current : Object.fromEntries(PORTABLE_KEYS.filter((k) => k in current).map((k) => [k, current[k]]));
  const fragment = tierAdapterConfig(tier, map, apiKey ? { apiKey } : {});
  const adapterConfig = { ...kept, ...fragment, [TIER_CONFIG_KEY]: tier };
  const env = { ...(kept.env ?? {}), ...(fragment.env ?? {}) };
  if (Object.keys(env).length) adapterConfig.env = env;
  return { adapterType: map.adapterType, adapterConfig };
}

/** Agents to update: every live agent that declares a tier, or the one named by --agent. */
export function selectTargets(agents, { agentName, tier } = {}) {
  const live = agents.filter((a) => a.status !== "terminated");
  if (agentName) {
    const agent = live.find((a) => a.name === agentName || a.id === agentName || a.urlKey === agentName);
    if (!agent) throw new Error(`agent "${agentName}" not found`);
    const resolved = tier ?? declaredTier(agent.adapterConfig);
    if (!resolved) throw new Error(`agent "${agent.name}" declares no tier; pass --tier ${MODEL_TIERS.join("|")}`);
    return [{ agent, tier: resolved }];
  }
  return live.flatMap((agent) => {
    const declared = declaredTier(agent.adapterConfig);
    return declared ? [{ agent, tier: declared }] : [];
  });
}

export async function applyTier({ companyName, provider = "9router", baseUrl, tiers, secretName = NINEROUTER_SECRET_NAME, apiKey, agentName, tier, resume = false, yes = false, log = console.log }) {
  if (tier && !isModelTier(tier)) throw new Error(`--tier must be one of ${MODEL_TIERS.join(", ")}`);
  const api = client();
  if (!(await api.healthy())) throw new Error(`Paperclip is not reachable at ${api.base}`);
  const company = await findCompany(api, companyName);

  let map;
  if (provider === "9router") {
    if (!baseUrl) throw new Error("--base-url (or NINEROUTER_BASE_URL) is required for --provider 9router");
    if (!tiers) throw new Error("--tiers fast=a,standard=b,reasoning=c is required for --provider 9router");
    map = ninerouterTiers({ baseUrl, models: tiers, adapterType: NINEROUTER_ADAPTER_TYPE });
    if (apiKey) {
      const listed = await listGatewayModels(map.gateway.baseUrl, apiKey);
      const unknown = [...new Set(Object.values(tiers))].filter((m) => !listed.includes(m));
      log(`9router at ${map.gateway.baseUrl}: ${listed.length} models/combos${unknown.length ? `; warning: not advertised: ${unknown.join(", ")}` : ""}`);
    }
  } else if (provider === "chatgpt") {
    map = DEFAULT_CODEX_TIERS;
  } else {
    throw new Error(`unknown --provider ${provider} (9router | chatgpt)`);
  }

  const targets = selectTargets(await api.get(`/companies/${company.id}/agents`), { agentName, tier });
  if (!targets.length) {
    log(`no agent in ${company.name} declares a tier. Run the pack setup first, or pick one with --agent and --tier.`);
    return { applied: [] };
  }

  log(`company ${company.name} (${company.issuePrefix}); provider ${provider}; adapter ${map.adapterType}`);
  for (const { agent, tier: t } of targets) {
    const c = map.tiers[t];
    log(`  ${agent.name.padEnd(28)} ${t.padEnd(9)} ${agent.adapterType}/${agent.adapterConfig?.model ?? "-"} -> ${map.adapterType}/${c.model}${c.reasoningEffort ? ` (${c.reasoningEffort})` : ""}${agent.status === "paused" ? "  [paused]" : ""}`);
  }
  if (!yes) {
    log("dry run. Re-run with --yes to write these adapter configs.");
    return { applied: [] };
  }

  let secret;
  if (provider === "9router") {
    const secretId = apiKey ? await upsertSecret(api, company.id, secretName, apiKey) : await findSecretId(api, company.id, secretName);
    if (!secretId) throw new Error(`company secret "${secretName}" not found: pass --secret <name>, or set ${NINEROUTER_ENV_KEY} once to create it`);
    secret = { type: "secret_ref", secretId };
  }

  const applied = [];
  for (const { agent, tier: t } of targets) {
    await api.patch(`/agents/${agent.id}`, tierPatch(agent, t, map, secret));
    if (resume && agent.status === "paused") await api.post(`/agents/${agent.id}/resume`, {});
    applied.push({ agent: agent.name, tier: t, model: map.tiers[t].model });
    log(`  applied ${agent.name}: ${t} -> ${map.tiers[t].model}${resume && agent.status === "paused" ? " (resumed)" : ""}`);
  }
  return { applied };
}

if (process.argv[1]?.endsWith("apply-tier.mjs")) {
  const provider = arg("--provider", "9router");
  applyTier({
    companyName: arg("--company", "Starnet Demo"),
    provider,
    baseUrl: arg("--base-url", process.env.NINEROUTER_BASE_URL),
    tiers: parseTiers(arg("--tiers")),
    secretName: arg("--secret", NINEROUTER_SECRET_NAME),
    apiKey: provider === "9router" ? process.env[NINEROUTER_ENV_KEY]?.trim() || undefined : undefined,
    agentName: arg("--agent"),
    tier: arg("--tier"),
    resume: process.argv.includes("--resume"),
    yes: process.argv.includes("--yes"),
  }).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
