import { fileURLToPath } from "node:url";
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { tierTemplate } from "@starnet/pack-kit";

export const PLUGIN_ID = "starnet.pack-isp";
export const NOC_AGENT_KEY = "noc-engineer";
export const NOC_LLM_AGENT_KEY = "noc-engineer-llm";
export const DAILY_ROUTINE_KEY = "daily-pppoe-check";
const NOC_LLM_TIER = tierTemplate("standard");

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

/** Read-only tools. Names are chosen so the gateway name heuristic classifies them as `read`. */
const ROUTER_PARAM = { type: "string", description: "Router name from mikrotik.list_routers. Default: all configured routers." };

export const TOOLS = [
  {
    name: "mikrotik.list_routers",
    displayName: "MikroTik: configured routers",
    description: "Names, hosts and transport (API/REST) of the configured MikroTik routers. No credentials. Read-only.",
    parametersSchema: obj({}),
  },
  {
    name: "mikrotik.list_pppoe_active",
    displayName: "MikroTik: active PPPoE sessions",
    description: "Active PPPoE sessions (/ppp/active) per router plus the total; unreachable routers are reported, not hidden. Read-only.",
    parametersSchema: obj({ limit: { type: "number", description: "Max sessions returned (default 50)." }, router: ROUTER_PARAM }),
  },
  {
    name: "mikrotik.system_resource",
    displayName: "MikroTik: system resource",
    description: "CPU load, memory, uptime and version (/system/resource) of each router; unreachable routers are reported. Read-only.",
    parametersSchema: obj({ router: ROUTER_PARAM }),
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
2. Post one comment summarizing: active PPPoE sessions (total and per router), CPU/memory/uptime of each router, CPE online/offline counts, and anything abnormal (router unreachable, CPU > 80%, memory > 85%, offline CPE > 10%).
3. State clearly if data came from MOCK mode (no device configured).
4. Mark this issue done. Never change device configuration from this routine.`;

const PACK_TOOL_CLI = fileURLToPath(new URL("../agent/pack-tool.mjs", import.meta.url));

const NOC_LLM_INSTRUCTIONS = `# NOC Engineer (Starnet ISP pack)

You are the NOC engineer of a Starnet ISP office. You monitor PPPoE sessions, router health and
customer CPE devices.

- Get data only from the starnet.pack-isp tools: mikrotik.list_routers, mikrotik.list_pppoe_active,
  mikrotik.system_resource, genieacs.list_devices, genieacs.device_status. Never guess numbers you
  did not read from a tool.
- There can be several MikroTik routers. Without \`router\` the MikroTik tools read all of them and
  report each one; pass router=<name> (names from mikrotik.list_routers) when asked about one router.
- If these tools are not offered to you natively, call them from the shell through the Paperclip
  tool gateway (same grants and policy):
    node "${PACK_TOOL_CLI}" list
    node "${PACK_TOOL_CLI}" mikrotik.list_routers
    node "${PACK_TOOL_CLI}" mikrotik.list_pppoe_active limit=50
    node "${PACK_TOOL_CLI}" mikrotik.system_resource router=<name>
    node "${PACK_TOOL_CLI}" genieacs.device_status deviceId=<id>
  Pass parameters as key=value (no JSON quoting needed). Do not call device APIs or the gateway
  in any other way.
- If the Starnet NMS pack is granted (it shows up in \`list\`), also use its read-only tools for
  monitoring questions: starnet.pack-nms:nms.list_problems (active Zabbix/LibreNMS problems,
  minSeverity=high for the urgent ones), starnet.pack-nms:nms.host_status (onlyDown=true or
  query=<host>), starnet.pack-nms:nms.list_sources. Use the full name with the CLI, e.g.
    node "${PACK_TOOL_CLI}" starnet.pack-nms:nms.list_problems minSeverity=high
- All tools are read-only. Never change device configuration, never run shell commands against
  network devices, and say so if a request needs a write action: it must go to a human operator.
- Flag as abnormal: a router UNREACHABLE, router CPU > 80%, memory > 85%, offline CPE > 10% of devices.
- If a tool result says MOCK mode, state clearly that the data is not from a live device.
- Reply in the requester's language (usually Indonesian). Keep answers short: the numbers, what is
  abnormal, and the suggested next step.
`;

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
    "instance.settings.register",
  ],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  instanceConfigSchema: {
    type: "object",
    properties: {
      mikrotikHost: { type: "string", description: "Main RouterOS host/IP (router name \"default\"). Leave empty, with no extra routers, for MOCK mode." },
      mikrotikProtocol: {
        type: "string",
        enum: ["api", "rest"],
        description: "api = RouterOS API (8728, or 8729 API-SSL). rest = REST over www/www-ssl (RouterOS 7). Default: api when the port is 8728/8729, otherwise rest.",
      },
      mikrotikPort: { type: "number", description: "8728 = API, 8729 = API-SSL, 80/443 = REST. Default 443 (REST) or 8728/8729 (API)." },
      mikrotikUseTls: { type: "boolean", description: "TLS for ports other than 8728/8729 (REST default on, API default off). Ignored on 8728 (plain) and 8729 (TLS)." },
      mikrotikTlsVerify: { type: "boolean", default: true, description: "Verify the router certificate on API-SSL. Turn off only for a self-signed certificate on a trusted network." },
      mikrotikUsername: { type: "string" },
      mikrotikPassword: { format: "secret-ref", description: "Company secret (value is a { type: \"secret_ref\", secretId } binding)." },
      mikrotikRouters: {
        type: "array",
        description: "Additional MikroTik routers. Each needs a unique name; port 8728/8729 selects the RouterOS API like the main router.",
        items: {
          type: "object",
          required: ["name", "host"],
          properties: {
            name: { type: "string", description: "Unique short name, e.g. bras-pusat (not \"default\")." },
            host: { type: "string" },
            protocol: { type: "string", enum: ["api", "rest"] },
            port: { type: "number" },
            useTls: { type: "boolean" },
            tlsVerify: { type: "boolean", default: true },
            username: { type: "string" },
            password: { format: "secret-ref", description: "Company secret; routers may share one." },
          },
        },
      },
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
    {
      agentKey: NOC_LLM_AGENT_KEY,
      displayName: "NOC Engineer (LLM)",
      role: "engineer",
      title: "NOC Engineer, LLM (Starnet ISP pack)",
      icon: "radio-tower",
      capabilities: "Answers NOC questions about PPPoE sessions, router health and CPE status using the Starnet ISP pack read-only tools.",
      // Model and gateway are per company: run `pnpm --filter @starnet/devkit apply-tier` to fill
      // them in and resume the agent. The deterministic NOC above keeps the daily routine.
      ...NOC_LLM_TIER,
      // A NOC answer takes 3-6 tool calls; stop runaway loops well before the adapter default (60).
      adapterConfig: { ...NOC_LLM_TIER.adapterConfig, starnetMaxToolCalls: 20 },
      runtimeConfig: { heartbeat: { enabled: false } },
      permissions: { pluginTools: [PLUGIN_ID], canCreateAgents: false, canCreateSkills: false },
      budgetMonthlyCents: 0,
      instructions: { entryFile: "AGENTS.md", content: NOC_LLM_INSTRUCTIONS },
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
    slots: [
      { type: "dashboardWidget", id: "noc-widget", displayName: "NOC status", exportName: "NocWidget" },
      // Replaces the auto-generated config form: compact router table, secret picker, connection test.
      { type: "settingsPage", id: "isp-settings", displayName: "Starnet ISP Pack", exportName: "SettingsPage" },
    ],
  },
};

export default manifest;
