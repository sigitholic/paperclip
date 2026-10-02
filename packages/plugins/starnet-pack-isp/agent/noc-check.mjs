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
const allNames = (Array.isArray(tools) ? tools : tools?.tools ?? []).map((t) => t.name);
const names = allNames.filter((n) => n.startsWith(PACK));
console.log(`[noc] pack tools visible via gateway: ${names.join(", ")}`);

// Starnet Memory: pull the curated context pack once per run. A plugin cannot inject text into this
// adapter's prompt, so the agent asks for it (agent-auth plugin route, run JWT). Only sizes are logged.
// Optional: if the memory plugin is missing or not ready, the run continues without it.
async function fetchMemory() {
  try {
    const q = encodeURIComponent(allNames.map((n) => n.slice(n.indexOf(":") + 1)).join(","));
    const res = await fetch(`${api}/plugins/starnet.memory/api/context/${issue.id}?tools=${q}`, {
      headers: { authorization: `Bearer ${runJwt}`, "x-paperclip-run-id": runId },
    });
    console.log(`GET /plugins/starnet.memory/api/context -> ${res.status}`);
    if (!res.ok) return null;
    const pack = await res.json();
    return typeof pack?.text === "string" && pack.meta ? pack : null;
  } catch {
    console.log("[noc] memory plugin unreachable, continuing without memory");
    return null;
  }
}
const memory = await fetchMemory();
const memoryPins = memory
  ? (memory.text.split("## Pins\n")[1] ?? "").split("\n## ")[0].split("\n").filter((l) => l.startsWith("- ")).map((l) => l.replace(/^- (📌 )?/, ""))
  : [];
if (memory) {
  const s = memory.savings;
  console.log(`[noc] memory pack: ${memory.meta.chars} chars (~${memory.meta.estTokens} tok), sections ${memory.meta.sections.map((x) => x.name).join("+")}; naive history ${s.naiveChars} chars (~${s.naiveTokens} tok); saved ${s.savedPct}%`);
}

async function tool(name, parameters = {}) {
  const out = await call("POST", "/tool-gateway/tools/call", { tool: PACK + name, parameters }, gw);
  let result = out; // gateway envelope -> dispatcher envelope -> plugin ToolResult { content, data }
  while (result && !("data" in result) && !result.error && result.result) result = result.result;
  if (result?.error) throw new Error(`${name}: ${result.error}`);
  if (!result?.data) throw new Error(`${name}: unexpected result shape (keys: ${Object.keys(out ?? {}).join(",")})`);
  return result;
}
// A failing source becomes an alert in the comment instead of crashing the run.
async function safeTool(name, parameters) {
  try {
    return await tool(name, parameters);
  } catch (err) {
    console.log(`[noc] ${err.message}`);
    return { error: err.message.replace(/^[\w.]+: /, "") };
  }
}
const pppoe = await safeTool("mikrotik.list_pppoe_active", { limit: 5 });
const res = await safeTool("mikrotik.system_resource");
const cpe = await safeTool("genieacs.list_devices", { limit: 100 });

// Optional demo knob: keep the run open a bit so live UIs (Virtual Office) can be observed. Off by default.
const demoDelayMs = Math.min(Number(process.env.NOC_DEMO_DELAY_MS ?? 0) || 0, 60000);
if (demoDelayMs > 0) {
  console.log(`[noc] NOC_DEMO_DELAY_MS=${demoDelayMs}: holding the run open`);
  await new Promise((r) => setTimeout(r, demoDelayMs));
}

const routers = res.data?.routers ?? [];
const multi = routers.length > 1;
const label = (name) => (multi ? `router ${name}` : "router");
const healthy = routers.filter((x) => x.ok);
const maxCpu = healthy.length ? Math.max(...healthy.map((x) => x.resource.cpuLoadPct)) : null;

// `devices` is only the first page (limit); count offline from the totals.
const offline = cpe.data?.devices.filter((d) => !d.online) ?? [];
const offlineCount = cpe.data ? cpe.data.total - cpe.data.online : 0;
// Drill into the first offline CPE (exercises genieacs.device_status).
const firstOffline = offline[0] ? await safeTool("genieacs.device_status", { deviceId: offline[0].id }) : null;
const alerts = [
  res.error && `MikroTik: ${res.error}`,
  pppoe.error && !res.error && `MikroTik PPPoE: ${pppoe.error}`,
  ...routers.filter((x) => !x.ok).map((x) => `router ${x.router} unreachable (${x.error})`),
  ...healthy.flatMap((x) => [
    x.resource.cpuLoadPct > 80 && `${label(x.router)} CPU ${x.resource.cpuLoadPct}%`,
    x.resource.memUsedPct > 85 && `${label(x.router)} memory ${x.resource.memUsedPct}%`,
  ]),
  cpe.error && `GenieACS: ${cpe.error}`,
  cpe.data?.total && offlineCount / cpe.data.total > 0.1 && `${offlineCount} CPE offline (${((offlineCount / cpe.data.total) * 100).toFixed(1)}%)`,
].filter(Boolean);
const mockSources = [...new Set([[pppoe, "mikrotik"], [res, "mikrotik"], [cpe, "genieacs"]].filter(([x]) => x.content?.startsWith("[MOCK")).map(([, s]) => s))];
const pppoeBreakdown = multi && pppoe.data?.routers ? ` (${pppoe.data.routers.map((x) => `${x.router} ${x.ok ? x.total : "?"}`).join(", ")})` : "";
const summary = [
  `Hasil: PPPoE aktif ${pppoe.data?.total ?? "?"}, CPE online ${cpe.data ? `${cpe.data.online}/${cpe.data.total}` : "?"}, CPU${multi ? " maks" : ""} ${maxCpu ?? "?"}%, alert: ${alerts.length ? alerts.join("; ") : "tidak ada"}`,
  "",
  `**${issue.title}**${mockSources.length ? ` — ⚠️ MOCK data for: ${mockSources.join(", ")} (no device configured)` : " — live data"}`,
  "",
  `- Active PPPoE sessions: **${pppoe.data?.total ?? "?"}**${pppoeBreakdown}`,
  ...routers.map((x) =>
    x.ok
      ? `- Router${multi ? ` **${x.router}**` : ""} ${x.resource.board} ${x.resource.version}: CPU **${x.resource.cpuLoadPct}%**, memory **${x.resource.memUsedPct}%**, uptime ${x.resource.uptime}`
      : `- Router **${x.router}** (${x.host}): ⚠️ unreachable — ${x.error}`,
  ),
  ...(cpe.data
    ? [`- CPE online: **${cpe.data.online}/${cpe.data.total}**${offline.length ? ` (offline ${offlineCount}: ${offline.slice(0, 5).map((d) => d.serial).join(", ")}${offlineCount > 5 ? ", …" : ""})` : ""}`]
    : []),
  ...(firstOffline?.content ? [`- First offline CPE: ${firstOffline.content}`] : []),
  `- Alerts: ${alerts.length ? alerts.join("; ") : "none"}`,
  ...(memoryPins.length ? ["", "Catatan board yang dipakai (Starnet Memory):", ...memoryPins.slice(0, 5).map((p) => `- ${p}`)] : []),
  ...(memory
    ? ["", `_Memori: context pack ${memory.meta.chars} karakter (~${memory.meta.estTokens} token) vs riwayat penuh ${memory.savings.naiveChars} karakter — hemat ${memory.savings.savedPct}%._`]
    : []),
  "",
  `_Tools called via Paperclip tool gateway (run ${runId}); read-only, no device changes._`,
].join("\n");

// No data from any source: leave the issue blocked so an operator looks at it.
const status = [pppoe, res, cpe].every((x) => x.error) ? "blocked" : "done";
await call("PATCH", `/issues/${issue.id}`, { status, comment: summary });
console.log(`[noc] summary posted, issue ${status}`);
