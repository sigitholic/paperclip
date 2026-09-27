#!/usr/bin/env node
// NOC Engineer — deterministic no-LLM agent for the Paperclip `process` adapter (validation spike).
// Heartbeat: inbox -> checkout -> tool-gateway session (run JWT) -> call pack tools -> summary comment -> done.
// Never prints tokens. Replace with an LLM adapter in production; the tools stay the same.
const api = `${process.env.PAPERCLIP_API_URL}/api`;
const runJwt = process.env.PAPERCLIP_API_KEY;
const runId = process.env.PAPERCLIP_RUN_ID;
const agentId = process.env.PAPERCLIP_AGENT_ID;
const PACK = "starnet.pack-isp:";

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${runJwt}`, "x-paperclip-run-id": runId, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(`${method} ${path.split("?")[0]} -> ${res.status}`);
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const inbox = await call("GET", "/agents/me/inbox-lite");
const items = Array.isArray(inbox) ? inbox : inbox?.items ?? inbox?.issues ?? [];
const issue = items.find((i) => ["todo", "backlog", "in_progress"].includes(i.status));
if (!issue) {
  console.log("[noc] inbox empty, nothing to do");
  process.exit(0);
}
console.log(`[noc] working on ${issue.identifier ?? issue.id}: ${issue.title}`);
await call("POST", `/issues/${issue.id}/checkout`, { agentId, expectedStatuses: ["todo", "backlog", "in_progress"] });

const session = await call("POST", "/tool-gateway/sessions", { issueId: issue.id });
const gw = { "x-paperclip-tool-gateway-token": session.token };
const tools = await call("GET", "/tool-gateway/tools", null, gw);
const names = (Array.isArray(tools) ? tools : tools?.tools ?? []).map((t) => t.name).filter((n) => n.startsWith(PACK));
console.log(`[noc] pack tools visible via gateway: ${names.join(", ")}`);

async function tool(name, parameters = {}) {
  const out = await call("POST", "/tool-gateway/tools/call", { tool: PACK + name, parameters }, gw);
  let result = out; // gateway envelope -> dispatcher envelope -> plugin ToolResult { content, data }
  while (result && !("data" in result) && !result.error && result.result) result = result.result;
  if (result?.error) throw new Error(`${name}: ${result.error}`);
  if (!result?.data) throw new Error(`${name}: unexpected result shape (keys: ${Object.keys(out ?? {}).join(",")})`);
  return result;
}
const pppoe = await tool("mikrotik.list_pppoe_active", { limit: 5 });
const res = await tool("mikrotik.system_resource");
const cpe = await tool("genieacs.list_devices", { limit: 100 });

const r = res.data.resource;
const offline = cpe.data.devices.filter((d) => !d.online);
// Drill into the first offline CPE (exercises genieacs.device_status).
const firstOffline = offline[0] ? await tool("genieacs.device_status", { deviceId: offline[0].id }) : null;
const alerts = [
  r.cpuLoadPct > 80 && `router CPU ${r.cpuLoadPct}%`,
  r.memUsedPct > 85 && `router memory ${r.memUsedPct}%`,
  cpe.data.total && offline.length / cpe.data.total > 0.1 && `${offline.length} CPE offline`,
].filter(Boolean);
const mockSources = [...new Set([[pppoe, "mikrotik"], [res, "mikrotik"], [cpe, "genieacs"]].filter(([x]) => x.content.startsWith("[MOCK")).map(([, s]) => s))];
const summary = [
  `**Daily NOC check**${mockSources.length ? ` — ⚠️ MOCK data for: ${mockSources.join(", ")} (no device configured)` : " — live data"}`,
  "",
  `- Active PPPoE sessions: **${pppoe.data.total}**`,
  `- Router ${r.board} ${r.version}: CPU **${r.cpuLoadPct}%**, memory **${r.memUsedPct}%**, uptime ${r.uptime}`,
  `- CPE online: **${cpe.data.online}/${cpe.data.total}**${offline.length ? ` (offline: ${offline.slice(0, 5).map((d) => d.serial).join(", ")}${offline.length > 5 ? ", …" : ""})` : ""}`,
  ...(firstOffline ? [`- First offline CPE: ${firstOffline.content}`] : []),
  `- Alerts: ${alerts.length ? alerts.join("; ") : "none"}`,
  "",
  `_Tools called via Paperclip tool gateway (run ${runId}); read-only, no device changes._`,
].join("\n");

await call("PATCH", `/issues/${issue.id}`, { status: "done", comment: summary });
console.log("[noc] summary posted, issue done");
