/**
 * Chat -> task routing. Pure and synchronous-looking so it is easy to test and to swap.
 *
 * LLM hook: implement `ChatRouter` with an LLM (same input/output) and pass it to
 * `createOfficeChat`/the worker instead of `keywordRouter`. The rest of the flow
 * (issue creation, assignment, wake, reply relay) does not change.
 */
export interface RoutableAgent { id: string; name: string; title?: string | null; role?: string | null; capabilities?: string | null }
export type RouteDecision =
  | { kind: "task"; agentId: string; title: string; reason: string }
  | { kind: "reply"; text: string };
export type ChatRouter = (input: { text: string; agents: RoutableAgent[] }) => Promise<RouteDecision>;

/** Domain keyword rules: which words belong to which kind of agent (matched against name/title/role/capabilities). */
export const RULES: Array<{ agent: RegExp; keywords: string[] }> = [
  { agent: /\bnoc\b|network|jaringan/i, keywords: ["pppoe", "router", "mikrotik", "cpe", "ont", "onu", "olt", "genieacs", "bandwidth", "internet", "jaringan", "network", "ping", "latency", "gangguan", "down", "redaman"] },
  { agent: /financ|billing|keuangan|accounting/i, keywords: ["tagihan", "invoice", "billing", "bayar", "pembayaran", "keuangan", "piutang"] },
  { agent: /support|customer|\bcs\b|helpdesk/i, keywords: ["pelanggan", "komplain", "keluhan", "customer", "pasang", "instalasi"] },
];

const REQUEST_VERBS = /^(tolong|mohon|please|cek|check|periksa|lihat|buat|buatkan|bikin|kirim|jalankan|run|restart|cari|laporkan|report|summarize|ringkas|analisa|analisis)\b/i;
const words = (s: string) => s.toLowerCase().normalize("NFKD").match(/[a-z0-9]+/g) ?? [];

function agentText(a: RoutableAgent) {
  return [a.name, a.title, a.role, a.capabilities].filter(Boolean).join(" ");
}

function titleFrom(text: string) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  const t = oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const keywordRouter: ChatRouter = async ({ text, agents }) => {
  const tokens = new Set(words(text));
  // 1. Explicit mention: "@NOC Engineer ..." or "@noc-engineer ..."
  const m = text.match(/@([\w-]+)(?:\s([\w-]+))?/);
  if (m) {
    const slug = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "-");
    const forms = [m[2] ? { raw: `@${m[1]} ${m[2]}`, key: slug(`${m[1]} ${m[2]}`) } : null, { raw: `@${m[1]}`, key: slug(m[1]!) }].filter((f) => f !== null);
    for (const f of forms) {
      const agent = agents.find((a) => slug(a.name) === f.key) ?? (f.key.length >= 3 ? agents.find((a) => slug(a.name).startsWith(f.key)) : undefined);
      if (agent) return { kind: "task", agentId: agent.id, title: titleFrom(text.replace(f.raw, "")), reason: `disebut langsung (@${agent.name})` };
    }
  }

  // 2. Domain rules, then 3. word overlap with the agent's own description.
  let best: { agent: RoutableAgent; score: number; hits: string[] } | null = null;
  for (const agent of agents) {
    const hits = new Set<string>();
    for (const rule of RULES) if (rule.agent.test(agentText(agent))) for (const k of rule.keywords) if (tokens.has(k)) hits.add(k);
    for (const w of words(agentText(agent))) if (w.length >= 5 && tokens.has(w)) hits.add(w);
    if (hits.size && (!best || hits.size > best.score)) best = { agent, score: hits.size, hits: [...hits] };
  }
  if (best) return { kind: "task", agentId: best.agent.id, title: titleFrom(text), reason: `kata kunci: ${best.hits.slice(0, 4).join(", ")}` };

  if (REQUEST_VERBS.test(text.trim())) {
    return { kind: "reply", text: "Saya belum tahu agen mana yang cocok untuk permintaan ini. Sebut agennya dengan @Nama, atau pakai kata kunci yang lebih spesifik." };
  }
  return { kind: "reply", text: "Dicatat. Kalau ini permintaan kerja, awali dengan kata kerja (mis. \"cek …\", \"tolong …\") atau sebut agennya dengan @Nama." };
};
