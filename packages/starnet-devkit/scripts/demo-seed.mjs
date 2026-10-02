#!/usr/bin/env node
// Seed (idempotently) a demo company on the local Paperclip instance:
//   company "Starnet Demo" -> Starnet plugins installed/ready -> ISP pack `setup`
//   (NOC Engineer, NOC Engineer (LLM), Daily PPPoE check) -> deny-by-default tool profile bound to both NOCs
//   -> pack config: mock (default) or --live (fake RouterOS/GenieACS on 127.0.0.1, see fake-servers).
// Usage: node packages/starnet-devkit/scripts/demo-seed.mjs [--company "Starnet Demo"] [--live|--mock]
// Talks REST only (PAPERCLIP_URL, default http://127.0.0.1:3100); never touches a database.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { client } from "../lib/api.mjs";
import { readState, STATE_FILE, writeState } from "../lib/state.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const PLUGINS = {
  "starnet.pack-isp": "packages/plugins/starnet-pack-isp",
  "starnet.office-chat": "packages/plugins/starnet-office-chat",
  "starnet.virtual-office": "packages/plugins/starnet-virtual-office",
  "starnet.memory": "packages/plugins/starnet-memory",
};
export const ISP_TOOLS = ["mikrotik.list_pppoe_active", "mikrotik.system_resource", "genieacs.list_devices", "genieacs.device_status"].map((t) => `starnet.pack-isp:${t}`);
export const FAKE = { routerosPort: 18728, genieacsPort: 17557, routerosUser: "noc-ro" };
const PROFILE_KEY = "starnet-noc-readonly";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

export async function seedDemo({ companyName = "Starnet Demo", mode, log = console.log } = {}) {
  const api = client();
  if (!(await api.healthy())) throw new Error(`Paperclip is not reachable at ${api.base}. Start it with /workspace/paperclip-start.sh`);
  const prev = readState();

  // 1. Plugins (instance-wide).
  let plugins = await api.plugins();
  for (const [key, rel] of Object.entries(PLUGINS)) {
    if (plugins[key]) continue;
    const path = join(REPO, rel);
    if (!existsSync(join(path, "dist", "manifest.js"))) throw new Error(`${key} is not built; run: pnpm --filter ./${rel} build`);
    log(`installing ${key} from ${rel}`);
    await api.post("/plugins/install", { packageName: path, isLocalPath: true });
  }
  plugins = await api.plugins();
  for (const key of Object.keys(PLUGINS)) {
    if (plugins[key]?.status !== "ready") throw new Error(`${key} is ${plugins[key]?.status ?? "missing"}, expected ready`);
  }
  const ids = Object.fromEntries(Object.keys(PLUGINS).map((k) => [k, plugins[k].id]));

  // 2. Company.
  const companies = await api.get("/companies");
  let company = companies.find((c) => c.name === companyName);
  if (!company) {
    company = await api.post("/companies", { name: companyName, description: "Starnet demo office (seeded by @starnet/devkit)" });
    log(`created company ${company.name} (${company.issuePrefix})`);
  }
  const companyId = company.id;

  // 3. ISP pack: managed NOC agent + routine.
  const setup = await api.action(ids["starnet.pack-isp"], "setup", companyId);
  const agentId = setup.agent?.agentId ?? setup.agent?.agent?.id;
  const llmAgentId = setup.llmAgent?.agentId ?? setup.llmAgent?.agent?.id ?? null;
  const routineId = setup.routine?.routineId ?? setup.routine?.routine?.id ?? null;
  if (!agentId) throw new Error(`setup did not return the NOC agent: ${JSON.stringify(setup).slice(0, 200)}`);
  const nocAgents = [agentId, ...(llmAgentId ? [llmAgentId] : [])];

  // 3b. Least privilege (board step): NOC agents must not hire agents, create skills or
  // assign tasks. Managed-agent reconcile does not update existing agents, so enforce it here.
  for (const id of nocAgents) {
    const agent = await api.get(`/agents/${id}`);
    const perms = agent.permissions ?? {};
    if (perms.canCreateAgents !== false || perms.canCreateSkills !== false) {
      await api.patch(`/agents/${id}/permissions`, { canCreateAgents: false, canCreateSkills: false, canAssignTasks: false });
      log(`${agent.name} permissions reduced (no hiring, no skills, no task-assign grant)`);
    }
  }

  // 4. Board step: deny-by-default tool profile with the four read-only tools, bound to both NOCs.
  const profiles = await api.get(`/companies/${companyId}/tools/profiles`);
  let profile = (Array.isArray(profiles) ? profiles : profiles.profiles ?? []).find((p) => p.profileKey === PROFILE_KEY);
  if (!profile) {
    profile = await api.post(`/companies/${companyId}/tools/profiles`, {
      profileKey: PROFILE_KEY,
      name: "Starnet NOC (read-only)",
      description: "Allows only the read-only Starnet ISP pack tools.",
      defaultAction: "deny",
      entries: ISP_TOOLS.map((toolName) => ({ selectorType: "tool_name", effect: "include", toolName })),
    });
  }
  for (const id of nocAgents) {
    try {
      await api.post(`/companies/${companyId}/tools/profiles/${profile.id}/bind`, { targetType: "agent", targetId: id });
    } catch (err) {
      if (err.status !== 409) throw err; // already bound
    }
  }

  // 5. Pack config: mock (no hosts) or live against the fake servers.
  mode = mode ?? prev?.mode ?? "mock";
  let fake = null;
  if (mode === "live") {
    const reuse = prev?.companyId === companyId && prev?.fake?.routerosPassword && prev?.fake?.secretId;
    fake = reuse ? prev.fake : { ...FAKE, routerosPassword: randomBytes(18).toString("base64url") };
    if (!reuse) {
      const secret = await api.post(`/companies/${companyId}/secrets`, { name: `starnet-demo-routeros-${Date.now()}`, value: fake.routerosPassword, description: "Fake RouterOS password (devkit)" });
      fake.secretId = secret.id;
    }
    await api.post(`/plugins/${ids["starnet.pack-isp"]}/config`, {
      companyId,
      configJson: {
        mikrotikHost: "127.0.0.1", mikrotikPort: fake.routerosPort, mikrotikUseTls: false, mikrotikUsername: fake.routerosUser,
        mikrotikPassword: { type: "secret_ref", secretId: fake.secretId },
        genieacsBaseUrl: `http://127.0.0.1:${fake.genieacsPort}`,
        timeoutMs: 4000,
      },
    });
  } else {
    await api.post(`/plugins/${ids["starnet.pack-isp"]}/config`, { companyId, configJson: {} });
  }

  const state = { companyId, companyName: company.name, issuePrefix: company.issuePrefix, plugins: ids, nocAgentId: agentId, nocLlmAgentId: llmAgentId, routineId, toolProfileId: profile.id, mode, fake, seededAt: new Date().toISOString() };
  writeState(state);
  log(`seeded ${company.name} [${company.issuePrefix}] mode=${mode}: noc=${agentId} noc-llm=${llmAgentId ?? "-"} profile=${profile.id} -> ${STATE_FILE}`);
  return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv.includes("--live") ? "live" : process.argv.includes("--mock") ? "mock" : undefined;
  seedDemo({ companyName: arg("--company", "Starnet Demo"), mode }).catch((err) => { console.error(`demo-seed failed: ${err.message}`); process.exit(1); });
}
