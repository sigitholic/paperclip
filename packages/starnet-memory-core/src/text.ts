// Zero-width, bidi-override and BOM characters: invisible to operators, visible to models.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
// C0/C1 control characters except tab and newline.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

export function hasInvisible(text: string): boolean {
  return new RegExp(INVISIBLE.source).test(text);
}

/** Normalizes line endings and strips invisible and control characters. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .replace(CONTROL, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** Collapses all whitespace to single spaces. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Clips to at most `max` characters, ending with "…" when cut. Never splits a surrogate pair. */
export function clip(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  if (max === 1) return "…";
  let cut = text.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Rough token estimate (≈ 4 characters per token for Latin text). Used for UI and savings, not billing. */
export function estimateTokens(textOrChars: string | number): number {
  const chars = typeof textOrChars === "number" ? textOrChars : textOrChars.length;
  return Math.ceil(chars / 4);
}

/** Removes simple markdown decoration from a single line. */
export function stripMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}|>|[-*•]|\d+[.)])\s+/, "")
    .replace(/[*_`~]+/g, "")
    .trim();
}
