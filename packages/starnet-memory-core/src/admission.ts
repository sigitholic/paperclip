import { scrubSecrets } from "./secrets.ts";
import { hasInvisible, normalizeText } from "./text.ts";
import type { AdmissionDecision, MemoryKind, MemorySource } from "./types.ts";

export interface AdmitOptions {
  /** Longer texts are rejected: memory stores facts, not documents. Default 1200. */
  maxChars?: number;
}

export interface AdmissionResult {
  decision: AdmissionDecision;
  /** Normalized, secret-scrubbed text. Store this, never the input. Empty when rejected. */
  text: string;
  reasons: string[];
  redactions: number;
}

export const ADMISSION_MAX_CHARS = 1200;

interface PoisonRule {
  id: string;
  re: RegExp;
}

// Prompt-injection / memory-poisoning signals, English and Indonesian.
const POISON_RULES: PoisonRule[] = [
  {
    id: "ignore_instructions",
    re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the|system)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|directives?|policies)\b/i,
  },
  {
    id: "ignore_instructions_id",
    re: /\b(abaikan|lupakan|acuhkan|langgar|jangan (?:ikuti|hiraukan|patuhi))\b[^.\n]{0,40}\b(instruksi|perintah|aturan|arahan|prompt|kebijakan)\b/i,
  },
  {
    id: "role_hijack",
    re: /\b(you are now|from now on,? you|act as (?:an? )?(?:unrestricted|jailbroken|dan|developer|admin|root)|pretend (?:to be|you are))\b/i,
  },
  {
    id: "role_hijack_id",
    re: /\b(mulai sekarang (?:kamu|anda|engkau)|(?:kamu|anda) sekarang adalah|berpura-puralah|anggap (?:dirimu|diri anda|kamu))\b/i,
  },
  { id: "system_prompt", re: /\b(system prompt|prompt sistem|developer mode|mode pengembang|jailbreak|do anything now)\b/i },
  {
    id: "exfiltration",
    re: /\b(reveal|print|show|leak|dump|send|exfiltrate|tampilkan|bocorkan|kirim(?:kan)?|tunjukkan|berikan)\b[^.\n]{0,40}\b(system prompt|api[ _-]?keys?|secrets?|passwords?|tokens?|credentials?|kata sandi|rahasia|kredensial)\b/i,
  },
  { id: "chat_markup", re: /(<\|im_(?:start|end)\|>|<\/?(?:system|assistant)>|\[\/?INST\]|^\s*#{2,3}\s*(?:system|instructions?)\b|BEGIN SYSTEM)/im },
  {
    id: "tool_coercion",
    re: /\b(always|must|selalu|wajib|harus)\b[^.\n]{0,30}\b(call|run|execute|invoke|panggil|jalankan)\b[^.\n]{0,40}\b(delete|remove|reboot|drop|wipe|hapus|matikan)\b/i,
  },
];

/** Returns the ids of every poison rule the text triggers (empty when clean). */
export function detectPoison(text: string): string[] {
  return POISON_RULES.filter((rule) => rule.re.test(text)).map((rule) => rule.id);
}

const ROLE_LINE =
  /^\s*(?:\[?\d{1,2}[:.]\d{2}(?::\d{2})?\]?\s*)?(?:user|assistant|system|human|ai|bot|agent|model|pengguna|asisten|operator|customer|pelanggan|cs)\s*[:>]/i;
const TIMESTAMP_SPEAKER_LINE = /^\s*\[\d{1,2}[:.]\d{2}(?::\d{2})?\]\s*[^:\n]{1,30}:/;
const JSON_ROLE = /"role"\s*:\s*"(?:user|assistant|system|tool)"/gi;

/** True when the text looks like a pasted conversation or log rather than a fact. */
export function looksLikeTranscript(text: string): boolean {
  const lines = text.split("\n");
  const roleLines = lines.filter((line) => ROLE_LINE.test(line) || TIMESTAMP_SPEAKER_LINE.test(line)).length;
  if (roleLines >= 3) return true;
  return (text.match(JSON_ROLE) ?? []).length >= 2;
}

const BOARD_CURATED_KINDS = new Set<MemoryKind>(["decision", "approval", "pin", "lesson", "failure", "note"]);

function baseTier(kind: MemoryKind, source: MemorySource): "curated" | "ephemeral" {
  if (source === "board" && BOARD_CURATED_KINDS.has(kind)) return "curated";
  if (source === "system" && kind === "summary") return "curated";
  // Agent and chat writes stay ephemeral until a board user promotes them.
  return "ephemeral";
}

/**
 * Write admission. Policy: default is do not write.
 * - reject: empty, transcript dumps, over-long text, text that is only secrets;
 * - quarantine: prompt-injection / poisoning signals or hidden characters (stored for review, never used);
 * - curated: board decisions/pins/lessons and system summaries;
 * - ephemeral: everything else (agent notes, chat).
 * Secrets are always scrubbed from the stored text.
 */
export function admit(text: string, kind: MemoryKind, source: MemorySource, opts: AdmitOptions = {}): AdmissionResult {
  const maxChars = opts.maxChars ?? ADMISSION_MAX_CHARS;
  const reasons: string[] = [];
  const invisible = hasInvisible(text);
  const normalized = normalizeText(text);
  if (!normalized) return { decision: "reject", text: "", reasons: ["empty"], redactions: 0 };
  if (looksLikeTranscript(normalized)) return { decision: "reject", text: "", reasons: ["transcript"], redactions: 0 };
  if (normalized.length > maxChars) return { decision: "reject", text: "", reasons: ["too_long"], redactions: 0 };

  const scrubbed = scrubSecrets(normalized);
  if (scrubbed.redactions > 0) {
    reasons.push("secret_redacted");
    const meaningful = scrubbed.text.replace(/\[REDACTED:[a-z_]+\]/g, "").replace(/[\s\p{P}]+/gu, "");
    if (meaningful.length < 12) {
      return { decision: "reject", text: "", reasons: [...reasons, "secret_only"], redactions: scrubbed.redactions };
    }
  }

  const poison = detectPoison(scrubbed.text);
  if (invisible) reasons.push("invisible_chars");
  if (poison.length > 0 || invisible) {
    reasons.push(...poison.map((id) => `poison:${id}`));
    return { decision: "quarantine", text: scrubbed.text, reasons, redactions: scrubbed.redactions };
  }
  return { decision: baseTier(kind, source), text: scrubbed.text, reasons, redactions: scrubbed.redactions };
}

/**
 * Board comment → pin command. Recognises "📌 …", "catat: …", "pin: …" and "/pin …".
 * Returns the note text, or null when the comment is not a pin command.
 */
export function parsePinCommand(body: string): string | null {
  const text = normalizeText(body);
  const match = /^(?:📌\s*|\/pin\b\s*|(?:catat|pin|ingat)\s*:\s*)([\s\S]+)$/iu.exec(text);
  if (!match) return null;
  const note = match[1].trim();
  return note.length > 0 ? note : null;
}
