export interface ScrubResult {
  text: string;
  redactions: number;
  types: string[];
}

const KEY_WORDS =
  "password|passwd|pwd|passphrase|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|kata ?sandi|sandi";

interface Rule {
  type: string;
  re: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}

const RULES: Rule[] = [
  {
    type: "private_key",
    re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    replace: () => "[REDACTED:private_key]",
  },
  { type: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: () => "[REDACTED:jwt]" },
  {
    type: "url_credentials",
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi,
    replace: (_m, scheme) => `${scheme}[REDACTED:credentials]@`,
  },
  {
    type: "provider_token",
    re: /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})\b/g,
    replace: () => "[REDACTED:token]",
  },
  { type: "bearer", re: /\b(bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, replace: (_m, word) => `${word} [REDACTED:token]` },
  {
    type: "key_value",
    re: new RegExp(`\\b(${KEY_WORDS})\\b(\\s*[:=]\\s*|\\s+(?:is|adalah|=)\\s+)("[^"\\n]*"|'[^'\\n]*'|[^\\s,;]+)`, "gi"),
    replace: (match, key, sep, value) => (value.startsWith("[REDACTED") ? match : `${key}${sep}[REDACTED:secret]`),
  },
];

/**
 * Replaces credentials with `[REDACTED:<type>]`. Deterministic and idempotent:
 * scrubbing already-scrubbed text changes nothing.
 */
export function scrubSecrets(input: string): ScrubResult {
  let text = input;
  let redactions = 0;
  const types = new Set<string>();
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      const match = args[0] as string;
      // args = [match, ...captures, offset, input]; no named groups are used.
      const groups = args.slice(1, -2).map((g) => (typeof g === "string" ? g : ""));
      const out = rule.replace(match, ...groups);
      if (out !== match) {
        redactions += 1;
        types.add(rule.type);
      }
      return out;
    });
  }
  return { text, redactions, types: [...types] };
}
