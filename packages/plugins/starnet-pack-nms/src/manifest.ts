import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { NMS_KINDS, SEVERITIES } from "./model.js";

export const PLUGIN_ID = "starnet.pack-nms";
export const ALERT_WEBHOOK_KEY = "alerts";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const SOURCE_PARAM = { type: "string", description: "NMS source name from nms.list_sources. Default: all sources." };

/** Read-only tools. Names avoid write verbs so the gateway classifies them as `read`. */
export const TOOLS = [
  {
    name: "nms.list_sources",
    displayName: "NMS: configured sources",
    description: "Names, kinds (zabbix/librenms) and URLs of the configured NMS sources. No credentials. Read-only.",
    parametersSchema: obj({}),
  },
  {
    name: "nms.list_problems",
    displayName: "NMS: active problems",
    description:
      "Active problems/alerts from Zabbix and LibreNMS with host, severity (info/warning/average/high/disaster) and start time, newest first. Unreachable sources are reported. Read-only.",
    parametersSchema: obj({
      source: SOURCE_PARAM,
      minSeverity: { type: "string", enum: [...SEVERITIES], description: "Only this severity and above (default: all)." },
      limit: { type: "number", description: "Max problems returned (default 50)." },
    }),
  },
  {
    name: "nms.host_status",
    displayName: "NMS: host status",
    description: "Up/down/disabled status and address of monitored hosts. Filter by name/address with query, or onlyDown. Read-only.",
    parametersSchema: obj({
      source: SOURCE_PARAM,
      query: { type: "string", description: "Case-insensitive match on host name or address." },
      onlyDown: { type: "boolean", description: "Only hosts that are down." },
      limit: { type: "number", description: "Max hosts returned (default 50)." },
    }),
  },
] as const;

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Starnet NMS Pack",
  description: "Read-only Zabbix + LibreNMS tools for NOC agents, and a webhook that turns NMS alerts into NOC issues (closed on recovery).",
  author: "Starnet",
  categories: ["connector", "automation", "ui"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
    "secrets.read-ref",
    "plugin.state.read",
    "plugin.state.write",
    "webhooks.receive",
    "companies.read",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "ui.dashboardWidget.register",
    "instance.settings.register",
  ],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  instanceConfigSchema: {
    type: "object",
    properties: {
      nmsSources: {
        type: "array",
        description: "Zabbix and LibreNMS servers. Leave empty for MOCK mode.",
        items: {
          type: "object",
          required: ["name", "kind", "baseUrl"],
          properties: {
            name: { type: "string", description: "Unique short name, e.g. zabbix-pusat." },
            kind: { type: "string", enum: [...NMS_KINDS] },
            baseUrl: { type: "string", description: "Zabbix frontend URL (…/zabbix) or LibreNMS URL." },
            token: { format: "secret-ref", description: "Zabbix API token or LibreNMS API token (company secret). Use a read-only user." },
          },
        },
      },
      webhookToken: { format: "secret-ref", description: "Shared secret NMS callers send in x-starnet-token. Webhooks are rejected until set." },
      alertAssigneeAgentId: { type: "string", description: "Agent that gets new alert issues (empty = unassigned)." },
      alertMinSeverity: { type: "string", enum: [...SEVERITIES], default: "warning", description: "Alerts below this severity do not open issues." },
      maxNewIssuesPerHour: { type: "number", default: 30, description: "Alert-storm guard: new alert issues per hour per company." },
      timeoutMs: { type: "number", default: 8000 },
    },
  },
  tools: TOOLS.map((t) => ({ ...t, parametersSchema: { ...t.parametersSchema } })),
  webhooks: [
    {
      endpointKey: ALERT_WEBHOOK_KEY,
      displayName: "NMS alerts",
      description: "Zabbix media type / LibreNMS API transport. Headers: x-starnet-company plus x-starnet-signature (HMAC) or x-starnet-token.",
    },
  ],
  ui: {
    slots: [
      { type: "dashboardWidget", id: "nms-widget", displayName: "NMS alerts", exportName: "NmsWidget" },
      { type: "settingsPage", id: "nms-settings", displayName: "Starnet NMS Pack", exportName: "SettingsPage" },
    ],
  },
};

export default manifest;
