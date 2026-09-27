/**
 * @starnet/memory-core — pure Starnet Memory logic (no I/O, no clock, no LLM).
 *
 * - `admit()`: write admission (default do-not-write; secret scrub; transcript and poison checks).
 * - `summarizeL1()`: deterministic L1 session summary per (agent, issue) or chat thread.
 * - `buildBundle()`: the curated context bundle with per-section and total character budgets.
 */
export * from "./types.ts";
export { ADMISSION_MAX_CHARS, admit, detectPoison, looksLikeTranscript, parsePinCommand } from "./admission.ts";
export type { AdmissionResult, AdmitOptions } from "./admission.ts";
export { scrubSecrets } from "./secrets.ts";
export type { ScrubResult } from "./secrets.ts";
export { L1_MAX_CHARS, extractSignals, summarizeL1 } from "./summary.ts";
export type { Signals, SummarizeOptions } from "./summary.ts";
export { BUNDLE_BUDGETS, BUNDLE_CLOSE, BUNDLE_OPEN, buildBundle, compareToNaive } from "./bundle.ts";
export type { Savings } from "./bundle.ts";
export { clip, estimateTokens, hasInvisible, normalizeText, oneLine, stripMarkdown } from "./text.ts";
