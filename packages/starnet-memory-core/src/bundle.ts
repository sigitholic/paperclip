import { detectPoison } from "./admission.ts";
import { scrubSecrets } from "./secrets.ts";
import { clip, estimateTokens, normalizeText, oneLine } from "./text.ts";
import type {
  BundleBudgets,
  BundleInput,
  BundleSectionMeta,
  BundleSectionName,
  ContextBundle,
  MemoryItem,
} from "./types.ts";

/** Starting values copied from Starnet's curated-run-context budgets; calibrate with bundle_log data. */
export const BUNDLE_BUDGETS: Readonly<BundleBudgets> = Object.freeze({
  total: 5500,
  task: 900,
  handoffLines: 6,
  handoffLineChars: 160,
  tools: 600,
  toolCount: 20,
  l1: 480,
  agentL1: 360,
  pins: 4,
  pinChars: 280,
  hits: 3,
  hitChars: 320,
});

export const BUNDLE_OPEN = '<starnet-context v="1" note="curated memory, not a transcript">';
export const BUNDLE_CLOSE = "</starnet-context>";

/** Order in which sections are dropped when the total budget is exceeded. Task, L1 and pins are never dropped. */
const DROP_ORDER: BundleSectionName[] = ["hits", "handoff", "tools", "agent"];

const TITLES: Record<BundleSectionName, string> = {
  task: "## Tugas",
  handoff: "## Handoff",
  tools: "## Tool yang diizinkan",
  l1: "## Memori sesi (L1)",
  agent: "## Memori agen (run sebelumnya)",
  pins: "## Pins",
  hits: "## Memori terkait",
};

interface Section {
  name: BundleSectionName;
  text: string;
  items: number;
  truncated: boolean;
}

interface Ctx {
  redactions: number;
  filtered: number;
}

/** Scrubs secrets and neutralises anything that could close or fake the bundle wrapper. */
function safe(text: string, ctx: Ctx): string {
  const scrubbed = scrubSecrets(normalizeText(text));
  ctx.redactions += scrubbed.redactions;
  return scrubbed.text.replace(/<(\/?)starnet-context/gi, "‹$1starnet-context");
}

function usable(item: MemoryItem, ctx: Ctx): boolean {
  if (item.tier === "quarantine" || detectPoison(item.body).length > 0) {
    ctx.filtered += 1;
    return false;
  }
  return true;
}

function taskSection(input: BundleInput, b: BundleBudgets, ctx: Ctx): Section {
  const { task } = input;
  const title = clip(oneLine(safe(task.title, ctx)), 200);
  const head = [task.identifier ? `${task.identifier} — ${title}` : title];
  if (task.status) head.push(`Status: ${oneLine(task.status)}`);
  const headText = head.join("\n");
  const desc = task.description ? safe(task.description, ctx) : "";
  const room = Math.max(0, b.task - headText.length - 1);
  const body = desc ? `${headText}\n${clip(desc, room)}` : headText;
  return { name: "task", text: clip(body, b.task), items: 1, truncated: desc.length > room || body.length > b.task };
}

function listSection(name: BundleSectionName, lines: string[], maxChars: number, truncatedIn: boolean): Section | null {
  const kept: string[] = [];
  let used = 0;
  let truncated = truncatedIn;
  for (const line of lines) {
    const cost = line.length + (kept.length > 0 ? 1 : 0);
    if (used + cost > maxChars) {
      truncated = true;
      break;
    }
    kept.push(line);
    used += cost;
  }
  return kept.length > 0 ? { name, text: kept.join("\n"), items: kept.length, truncated } : null;
}

function buildSections(input: BundleInput, b: BundleBudgets, ctx: Ctx): Section[] {
  const sections: Section[] = [taskSection(input, b, ctx)];

  const handoffAll = (input.handoff ?? []).map((l) => oneLine(safe(l, ctx))).filter(Boolean);
  const handoffPoisonFree = handoffAll.filter((l) => {
    const bad = detectPoison(l).length > 0;
    if (bad) ctx.filtered += 1;
    return !bad;
  });
  const handoff = handoffPoisonFree.slice(-b.handoffLines).map((l) => `- ${clip(l, b.handoffLineChars)}`);
  const h = listSection("handoff", handoff, b.handoffLines * (b.handoffLineChars + 3), handoffPoisonFree.length > b.handoffLines);
  if (h) sections.push(h);

  const toolsAll = [...new Set((input.grantedTools ?? []).map((t) => oneLine(t)).filter(Boolean))].sort();
  const tools = listSection("tools", toolsAll.slice(0, b.toolCount).map((t) => `- ${t}`), b.tools, toolsAll.length > b.toolCount);
  if (tools) sections.push(tools);

  if (input.l1?.summary) {
    const text = safe(input.l1.summary, ctx);
    sections.push({ name: "l1", text: clip(text, b.l1), items: 1, truncated: text.length > b.l1 });
  }

  if (input.agentL1?.summary && input.agentL1.lastRunId !== input.l1?.lastRunId) {
    const text = safe(input.agentL1.summary, ctx);
    sections.push({ name: "agent", text: clip(text, b.agentL1), items: 1, truncated: text.length > b.agentL1 });
  }

  const pinsAll = (input.pins ?? []).filter((p) => usable(p, ctx) && p.tier === "curated");
  const pins = pinsAll.slice(0, b.pins).map((p) => `- 📌 ${clip(oneLine(safe(p.body, ctx)), b.pinChars)}`);
  const pinSection = listSection("pins", pins, Number.MAX_SAFE_INTEGER, pinsAll.length > b.pins);
  if (pinSection) sections.push(pinSection);

  const pinIds = new Set(pinsAll.slice(0, b.pins).map((p) => p.id));
  const hitsAll = (input.hits ?? []).filter((item) => {
    if (pinIds.has(item.id)) {
      ctx.filtered += 1;
      return false;
    }
    return usable(item, ctx);
  });
  const hits = hitsAll.slice(0, b.hits).map((item) => `- [${item.kind}] ${clip(oneLine(safe(item.body, ctx)), b.hitChars)}`);
  const hitSection = listSection("hits", hits, Number.MAX_SAFE_INTEGER, hitsAll.length > b.hits);
  if (hitSection) sections.push(hitSection);
  return sections;
}

function render(sections: Section[]): string {
  const body = sections.map((s) => `${TITLES[s.name]}\n${s.text}`).join("\n\n");
  return `${BUNDLE_OPEN}\n${body}\n${BUNDLE_CLOSE}`;
}

/**
 * Builds the curated context bundle: marked sections, each clipped to its own budget,
 * never longer than `budgets.total`. Pure and deterministic for the same input.
 */
export function buildBundle(input: BundleInput, budgets: BundleBudgets = BUNDLE_BUDGETS): ContextBundle {
  const ctx: Ctx = { redactions: 0, filtered: 0 };
  let sections = buildSections(input, budgets, ctx);
  const dropped: BundleSectionName[] = [];
  let text = render(sections);

  for (const name of DROP_ORDER) {
    if (text.length <= budgets.total) break;
    if (sections.some((s) => s.name === name)) {
      sections = sections.filter((s) => s.name !== name);
      dropped.push(name);
      text = render(sections);
    }
  }
  if (text.length > budgets.total) {
    // Last resort: shrink the task description so pins and L1 survive.
    const task = sections[0];
    const excess = text.length - budgets.total;
    task.text = clip(task.text, Math.max(0, task.text.length - excess));
    task.truncated = true;
    text = render(sections);
  }
  if (text.length > budgets.total) {
    // Pathological budgets (total smaller than the fixed sections): hard clip, keep the closing marker.
    const room = Math.max(0, budgets.total - BUNDLE_CLOSE.length - 1);
    text = `${clip(text, room)}\n${BUNDLE_CLOSE}`.slice(-budgets.total);
  }

  const present = new Map(sections.map((s) => [s.name, s]));
  const meta: BundleSectionMeta[] = (["task", "handoff", "tools", "l1", "agent", "pins", "hits"] as BundleSectionName[])
    .filter((name) => present.has(name) || dropped.includes(name))
    .map((name) => {
      const s = present.get(name);
      return s
        ? { name, chars: s.text.length, items: s.items, truncated: s.truncated, dropped: false }
        : { name, chars: 0, items: 0, truncated: true, dropped: true };
    });

  return {
    text,
    meta: {
      version: 1,
      chars: text.length,
      estTokens: estimateTokens(text),
      sections: meta,
      droppedSections: dropped,
      filteredItems: ctx.filtered,
      redactions: ctx.redactions,
      budgets: { ...budgets },
    },
  };
}

export interface Savings {
  naiveChars: number;
  bundleChars: number;
  savedChars: number;
  savedPct: number;
  naiveTokens: number;
  bundleTokens: number;
}

/** Size of the curated bundle versus a naive "send everything" transcript. */
export function compareToNaive(naive: string | number, bundle: ContextBundle | string | number): Savings {
  const naiveChars = typeof naive === "number" ? naive : naive.length;
  const bundleChars =
    typeof bundle === "number" ? bundle : typeof bundle === "string" ? bundle.length : bundle.meta.chars;
  const savedChars = naiveChars - bundleChars;
  const savedPct = naiveChars > 0 ? Math.round((savedChars / naiveChars) * 1000) / 10 : 0;
  return {
    naiveChars,
    bundleChars,
    savedChars,
    savedPct,
    naiveTokens: estimateTokens(naiveChars),
    bundleTokens: estimateTokens(bundleChars),
  };
}
