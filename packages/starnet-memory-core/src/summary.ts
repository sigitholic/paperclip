import { detectPoison, looksLikeTranscript } from "./admission.ts";
import { scrubSecrets } from "./secrets.ts";
import { clip, normalizeText, oneLine, stripMarkdown } from "./text.ts";
import type { RunOutcome, SessionL1 } from "./types.ts";

export const L1_MAX_CHARS = 480;

export interface SummarizeOptions {
  maxChars?: number;
  /** Replaces the pin id list (e.g. the current pins of the issue). Defaults to the previous list. */
  pinIds?: string[];
}

export interface Signals {
  decisions: string[];
  next: string[];
  blockers: string[];
}

const SIGNAL_RULES: Array<{ key: keyof Signals; re: RegExp }> = [
  { key: "decisions", re: /^(?:keputusan|decision|decided|diputuskan)\s*[:：-]\s*(.+)$/i },
  { key: "next", re: /^(?:next|selanjutnya|langkah berikut(?:nya)?|tindak lanjut|todo)\s*[:：-]\s*(.+)$/i },
  { key: "blockers", re: /^(?:blocker|blocked|kendala|hambatan)\s*[:：-]\s*(.+)$/i },
];

const RESULT_LINE = /^(?:hasil|result|ringkasan|summary)\s*[:：-]\s*(.+)$/i;

const SIGNAL_ITEM_CHARS = 140;
const HEADLINE_CHARS = 200;

const STATUS_LABEL: Record<string, string> = {
  succeeded: "selesai",
  failed: "gagal",
  cancelled: "dibatalkan",
  timed_out: "timeout",
};

function isSignalLine(line: string): boolean {
  return RESULT_LINE.test(line) || SIGNAL_RULES.some((rule) => rule.re.test(line));
}

/** Latest explicit "Hasil:/Result:/Ringkasan:" line, if any. */
function explicitResult(sources: string[]): string {
  for (const text of [...sources].reverse()) {
    for (const raw of text.split("\n")) {
      const match = RESULT_LINE.exec(stripMarkdown(raw));
      if (match) return clip(oneLine(match[1]), HEADLINE_CHARS);
    }
  }
  return "";
}

/** Pulls "Keputusan:/Decision:", "Next:/Selanjutnya:" and "Blocker:/Kendala:" lines out of free text. */
export function extractSignals(text: string): Signals {
  const out: Signals = { decisions: [], next: [], blockers: [] };
  for (const raw of text.split("\n")) {
    const line = stripMarkdown(raw);
    for (const rule of SIGNAL_RULES) {
      const match = rule.re.exec(line);
      if (match) out[rule.key].push(clip(oneLine(match[1]), SIGNAL_ITEM_CHARS));
    }
  }
  return out;
}

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function carriedHeadline(prev: SessionL1 | null): string {
  const line = prev?.summary.split("\n").find((l) => l.startsWith("Hasil: ") || l.startsWith("Sebelumnya: "));
  return line ? line.replace(/^(Hasil|Sebelumnya): /, "") : "";
}

function carriedDecisions(prev: SessionL1 | null): string[] {
  if (!prev) return [];
  return prev.summary
    .split("\n")
    .filter((line) => line.startsWith("Keputusan: "))
    .map((line) => line.slice("Keputusan: ".length));
}

/**
 * Deterministic L1 session summary (no LLM). Keeps a status line, a one-line result,
 * blockers, decisions (new first, then carried over) and next steps, within `maxChars`.
 * Secrets are scrubbed, poisoned lines are dropped, and transcripts only contribute signal lines.
 * Idempotent per run: summarizing the same run twice returns the previous value.
 */
export function summarizeL1(prev: SessionL1 | null, outcome: RunOutcome, opts: SummarizeOptions = {}): SessionL1 {
  if (prev && prev.lastRunId === outcome.runId) return prev;
  const maxChars = opts.maxChars ?? L1_MAX_CHARS;
  const flags = new Set<string>();

  const sources = [outcome.summary ?? "", ...(outcome.comments ?? [])]
    .map((text) => {
      const scrubbed = scrubSecrets(normalizeText(text));
      if (scrubbed.redactions > 0) flags.add("secret_redacted");
      return scrubbed.text;
    })
    .filter(Boolean);

  const cleanSources = sources.map((text) =>
    text
      .split("\n")
      .filter((line) => {
        const poisoned = detectPoison(line).length > 0;
        if (poisoned) flags.add("poison_line_dropped");
        return !poisoned;
      })
      .join("\n"),
  );

  const combined = cleanSources.join("\n");
  const transcript = looksLikeTranscript(combined);
  if (transcript) flags.add("transcript_ignored");

  const signals = extractSignals(combined);
  let headline = transcript ? "" : explicitResult(cleanSources);
  if (!transcript && !headline) {
    // Prefer the latest comment's first plain line, then the run summary.
    for (const text of [...cleanSources].reverse()) {
      const line = text
        .split("\n")
        .map(stripMarkdown)
        .find((l) => l.length > 0 && !isSignalLine(l));
      if (line) {
        headline = clip(oneLine(line), HEADLINE_CHARS);
        break;
      }
    }
  }

  const status = STATUS_LABEL[outcome.status] ?? outcome.status;
  const when = outcome.finishedAt.slice(0, 16).replace("T", " ");
  const lines: string[] = [`Run ${outcome.runId.slice(0, 8)} ${status} ${when}Z`];
  if (outcome.error && outcome.status !== "succeeded") {
    lines.push(`Error: ${clip(oneLine(scrubSecrets(normalizeText(outcome.error)).text), 120)}`);
  }
  if (headline) lines.push(`Hasil: ${headline}`);
  else if (carriedHeadline(prev)) lines.push(`Sebelumnya: ${carriedHeadline(prev)}`);
  for (const b of uniq(signals.blockers)) lines.push(`Kendala: ${b}`);
  const decisions = uniq([...signals.decisions, ...carriedDecisions(prev)]);
  const newDecisionCount = uniq(signals.decisions).length;
  decisions.slice(0, newDecisionCount).forEach((d) => lines.push(`Keputusan: ${d}`));
  for (const n of uniq(signals.next)) lines.push(`Next: ${n}`);
  decisions.slice(newDecisionCount).forEach((d) => lines.push(`Keputusan: ${d}`));

  // Fill in priority order; the first line is always kept (clipped if needed).
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + (kept.length > 0 ? 1 : 0);
    if (used + cost <= maxChars) {
      kept.push(line);
      used += cost;
    } else if (kept.length === 0) {
      kept.push(clip(line, maxChars));
      used = kept[0].length;
    } else {
      flags.add("clipped");
    }
  }

  return {
    summary: kept.join("\n"),
    pinIds: uniq(opts.pinIds ?? prev?.pinIds ?? []),
    lastRunId: outcome.runId,
    runCount: (prev?.runCount ?? 0) + 1,
    updatedAt: outcome.finishedAt,
    flags: [...flags].sort(),
  };
}
