import { fileURLToPath } from "node:url";
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "starnet.pack-isp";
export const NOC_AGENT_KEY = "noc-engineer";
export const DAILY_ROUTINE_KEY = "daily-pppoe-check";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

/** Read-only tools. Names are chosen so the gateway name heuristic classifies them as `read`. */
export const TOOLS = [
  {
    name: "mikrotik.list_pppoe_active",
    displayName: "MikroTik: active PPPoE sessions",
    description: "List active PPPoE sessions on the configured MikroTik router (RouterOS REST /rest/ppp/active). Read-only.",
    parametersSchema: obj({ limit: { type: "number", description: "Max sessions returned (default 50)." } }),
  },
  {
    name: "mikrotik.system_resource",
    displayName: "MikroTik: system resource",
    description: "CPU load, memory, uptime and version of the configured MikroTik router (RouterOS REST /rest/system/resource). Read-only.",
    parametersSchema: obj({}),
  },
  {
    name: "genieacs.list_devices",
    displayName: "GenieACS: list CPE devices",
    description: "List CPE devices known to GenieACS with online/offline status derived from last inform. Read-only.",
    parametersSchema: obj({
      limit: { type: "number", description: "Max devices returned (default 50)." },
      onlineOnly: { type: "boolean" },
    }),
  },
  {
    name: "genieacs.device_status",
    displayName: "GenieACS: device status",
    description: "Status of one CPE device by GenieACS device id (last inform, online, firmware, PPPoE username). Read-only.",
    parametersSchema: obj({ deviceId: { type: "string" } }, ["deviceId"]),
  },
] as const;

const ROUTINE_BRIEF = `Daily NOC check (Starnet ISP pack).

1. Call starnet.pack-isp tools: mikrotik.list_pppoe_active, mikrotik.system_resource, genieacs.list_devices.
2. Post one comment summarizing: active PPPoE sessions, router CPU/memory/uptime, CPE online/offline counts, and anything abnormal (CPU > 80%, memory > 85%, offline CPE > 10%).
3. State clearly if data came from MOCK mode (no device configured).
4. Mark this issue done. Never change device configuration from this routine.`;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Starnet ISP Pack",
  description: "Read-only MikroTik + GenieACS tools, a NOC Engineer agent, a daily PPPoE check routine and a NOC dashboard widget.",
  author: "Starnet",
  categories: ["connector", "automation", "ui"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "agents.managed",
    "routines.managed",
    "ui.dashboardWidget.register",
  ],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  instanceConfigSchema: {
    type: "object",
    properties: {
      mikrotikHost: { type: "string", description: "RouterOS host/IP. Leave empty for MOCK mode." },
      mikrotikPort: { type: "number", description: "REST port (default 443 with TLS, 80 without)." },
      mikrotikUseTls: { type: "boolean", default: true },
      mikrotikUsername: { type: "string" },
      mikrotikPassword: { format: "secret-ref", description: "Company secret (value is a { type: \"secret_ref\", secretId } binding)." },
      genieacsBaseUrl: { type: "string", description: "GenieACS NBI URL, e.g. http://acs:7557. Leave empty for MOCK mode." },
      genieacsUsername: { type: "string" },
      genieacsPassword: { format: "secret-ref" },
      onlineWindowMinutes: { type: "number", default: 15, description: "CPE counts as online if it informed within this window." },
      timeoutMs: { type: "number", default: 8000 },
    },
  },
  tools: TOOLS.map((t) => ({ ...t, parametersSchema: { ...t.parametersSchema } })),
  agents: [
    {
      agentKey: NOC_AGENT_KEY,
      displayName: "NOC Engineer",
      role: "engineer",
      title: "NOC Engineer (Starnet ISP pack)",
      icon: "radio-tower",
      capabilities: "Monitors PPPoE sessions, router health and CPE status using the Starnet ISP pack read-only tools.",
      // Validation spike: a deterministic no-LLM script. In production swap to an LLM adapter
      // (e.g. adapterPreference: ["claude_local", "codex_local"]) with the same tools.
      adapterType: "process",
      adapterConfig: {
        command: "node",
        args: [fileURLToPath(new URL("../agent/noc-check.mjs", import.meta.url))],
        timeoutSec: 120,
      },
      runtimeConfig: { heartbeat: { enabled: false } },
      // Least privilege: explicit booleans override the host's "new agent may hire agents" default.
      // (Existing agents are not updated by reconcile; see README "Least privilege".)
      permissions: { pluginTools: [PLUGIN_ID], canCreateAgents: false, canCreateSkills: false },
      status: "idle",
      budgetMonthlyCents: 0,
    },
  ],
  routines: [
    {
      routineKey: DAILY_ROUTINE_KEY,
      title: "Daily PPPoE check",
      description: ROUTINE_BRIEF,
      status: "active",
      priority: "medium",
      assigneeRef: { resourceKind: "agent", resourceKey: NOC_AGENT_KEY },
      concurrencyPolicy: "skip_if_active",
      catchUpPolicy: "skip_missed",
      triggers: [
        {
          kind: "schedule",
          label: "Every day 07:00 WIB",
          enabled: true,
          cronExpression: "0 7 * * *",
          timezone: "Asia/Jakarta",
          signingMode: null,
          replayWindowSec: null,
        },
      ],
      issueTemplate: { billingCode: "starnet-pack-isp:noc" },
    },
  ],
  ui: {
    slots: [{ type: "dashboardWidget", id: "noc-widget", displayName: "NOC status", exportName: "NocWidget" }],
  },
};

export default manifest;
