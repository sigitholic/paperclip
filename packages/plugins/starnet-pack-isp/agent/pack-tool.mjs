#!/usr/bin/env node
// Call Starnet ISP pack tools from an LLM agent's shell, through the Paperclip tool gateway.
//
// Adapters other than codex_local get no managed MCP tool gateway, so their agents reach plugin
// tools the same way the deterministic NOC does: a gateway session bound to the current issue and
// the run JWT. Grants and tool policy are enforced by the gateway. Never prints tokens.
//
// Usage: node pack-tool.mjs list
//        node pack-tool.mjs <tool> [key=value ...]     e.g. mikrotik.list_pppoe_active limit=50
// key=value avoids JSON quoting, which PowerShell mangles; a single JSON object argument also works.
const PACK = "starnet.pack-isp:";
const { PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_RUN_ID, PAPERCLIP_TASK_ID } = process.env;

function fail(message) {
  console.error(`pack-tool: ${message}`);
  process.exitCode = 1;
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${PAPERCLIP_API_URL.replace(/\/+$/, "").replace(/\/api$/, "")}/api${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${PAPERCLIP_API_KEY}`, "x-paperclip-run-id": PAPERCLIP_RUN_ID ?? "", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Gateway envelope -> dispatcher envelope -> plugin ToolResult { content, data }. */
export function unwrapToolResult(out) {
  let result = out;
  while (result && !("data" in result) && !("content" in result) && !result.error && result.result) result = result.result;
  return result;
}

/** `limit=50 onlineOnly=true deviceId=abc` -> { limit: 50, onlineOnly: true, deviceId: "abc" }. */
export function parseParams(args) {
  if (args.length === 1 && args[0].trim().startsWith("{")) return JSON.parse(args[0]);
  return Object.fromEntries(
    args.map((arg) => {
      const i = arg.indexOf("=");
      if (i <= 0) throw new Error(`expected key=value, got: ${arg}`);
      const raw = arg.slice(i + 1);
      const value = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
      return [arg.slice(0, i), value];
    }),
  );
}

async function main([name, ...rawParams]) {
  if (!name) return fail("usage: pack-tool.mjs list | <tool> [key=value ...]");
  if (!PAPERCLIP_API_URL || !PAPERCLIP_API_KEY) return fail("PAPERCLIP_API_URL / PAPERCLIP_API_KEY are not set; run this inside a Paperclip agent run");
  if (!PAPERCLIP_TASK_ID) return fail("PAPERCLIP_TASK_ID is not set; tools are only available while working on an issue");
  let parameters;
  try { parameters = parseParams(rawParams); } catch (err) { return fail(err.message); }

  const session = await call("POST", "/tool-gateway/sessions", { issueId: PAPERCLIP_TASK_ID });
  const gw = { "x-paperclip-tool-gateway-token": session.token };
  if (name === "list") {
    const tools = await call("GET", "/tool-gateway/tools", null, gw);
    const pack = (Array.isArray(tools) ? tools : tools?.tools ?? []).filter((t) => t.name.startsWith(PACK));
    for (const t of pack) console.log(`${t.name.slice(PACK.length)}  ${t.description ?? ""}`);
    if (!pack.length) fail("no starnet.pack-isp tools are granted to this agent");
    return;
  }
  const result = unwrapToolResult(await call("POST", "/tool-gateway/tools/call", { tool: PACK + name.replace(PACK, ""), parameters }, gw));
  if (result?.error) return fail(`${name}: ${result.error}`);
  if (result?.content) console.log(result.content);
  if (result?.data !== undefined) console.log(JSON.stringify(result.data, null, 2));
}

if (process.argv[1]?.endsWith("pack-tool.mjs")) {
  main(process.argv.slice(2)).catch((err) => fail(err.message));
}
