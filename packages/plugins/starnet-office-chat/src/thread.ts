/** Chat thread model + pure event -> thread mapping (no I/O; unit-tested). */
export interface ChatMessage {
  id: string;
  at: string;
  role: "operator" | "office" | "agent";
  text: string;
  agentId?: string | null;
  agentName?: string | null;
  issueId?: string | null;
  issueIdentifier?: string | null;
  /** "status" marks an issue status note; it must stay after that issue's agent replies. */
  kind?: "status";
}
export interface TrackedIssue { messageId: string; agentId: string; agentName: string; identifier: string | null; status: string | null; seenCommentIds: string[] }
export interface Thread { messages: ChatMessage[]; tracked: Record<string, TrackedIssue> }
export interface CommentLike { id: string; body: string; authorAgentId?: string | null; createdAt?: string | Date }

export const MAX_MESSAGES = 300;
export const emptyThread = (): Thread => ({ messages: [], tracked: {} });

/** Append and keep chronological order (a status event can be processed before the comment that caused it). */
export function append(t: Thread, ...msgs: ChatMessage[]): Thread {
  const all = [...t.messages, ...msgs].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)); // stable
  return { ...t, messages: all.slice(-MAX_MESSAGES) };
}

export function track(t: Thread, issueId: string, entry: Omit<TrackedIssue, "seenCommentIds" | "status">): Thread {
  return { ...t, tracked: { ...t.tracked, [issueId]: { ...entry, status: "todo", seenCommentIds: [] } } };
}

const iso = (d?: string | Date) => (d ? new Date(d).toISOString() : new Date().toISOString());
// in_progress is left out on purpose: the "mulai mengerjakan…" run note already says it, and a
// status note re-stamped after the reply would read as if work restarted.
const STATUS_TEXT: Record<string, string> = { done: "selesai ✅", blocked: "terblokir ⚠️", cancelled: "dibatalkan", in_review: "menunggu review" };

/**
 * Sync one tracked issue: new agent comments become agent messages (only comments on
 * that issue — agents never see the chat transcript), and status changes become short
 * office notes. Returns the same thread object when nothing changed.
 */
export function syncIssue(t: Thread, issueId: string, issue: { status: string } | null, comments: CommentLike[], newId: () => string): Thread {
  const tr = t.tracked[issueId];
  if (!tr) return t;
  const seen = new Set(tr.seenCommentIds);
  const fresh = comments.filter((c) => !seen.has(c.id));
  const msgs: ChatMessage[] = fresh
    .filter((c) => c.authorAgentId)
    .map((c) => ({ id: newId(), at: iso(c.createdAt), role: "agent", text: c.body, agentId: c.authorAgentId, agentName: c.authorAgentId === tr.agentId ? tr.agentName : null, issueId, issueIdentifier: tr.identifier }));
  // An agent often posts its result and closes the issue in the same second, and the status
  // event can arrive first. Status notes are stamped just after the newest reply so the
  // thread never shows "selesai" before the answer it refers to.
  const lastReplyAt = msgs.reduce((max, m) => (m.at > max ? m.at : max), "");
  const after = (at: string) => (lastReplyAt && at <= lastReplyAt ? new Date(Date.parse(lastReplyAt) + 1).toISOString() : at);
  const status = issue?.status ?? tr.status;
  if (status !== tr.status && STATUS_TEXT[status ?? ""]) {
    msgs.push({ id: newId(), at: after(iso()), role: "office", kind: "status", text: `${tr.identifier ?? "Tugas"} ${STATUS_TEXT[status!]}`, issueId, issueIdentifier: tr.identifier, agentId: tr.agentId, agentName: tr.agentName });
  }
  if (!fresh.length && status === tr.status) return t;
  const next: TrackedIssue = { ...tr, status, seenCommentIds: [...tr.seenCommentIds, ...fresh.map((c) => c.id)].slice(-200) };
  const existing = t.messages.map((m) => (m.kind === "status" && m.issueId === issueId ? { ...m, at: after(m.at) } : m));
  return append({ messages: existing, tracked: { ...t.tracked, [issueId]: next } }, ...msgs);
}

/** Run lifecycle event for a tracked issue -> one office note (or nothing). */
export function runNote(t: Thread, eventType: string, payload: { issueId?: string | null; error?: string | null }, newId: () => string): ChatMessage | null {
  const tr = payload.issueId ? t.tracked[payload.issueId] : undefined;
  if (!tr) return null;
  const text =
    eventType === "agent.run.started" ? `${tr.agentName} mulai mengerjakan ${tr.identifier ?? "tugas"}…`
    : eventType === "agent.run.failed" ? `Run ${tr.agentName} untuk ${tr.identifier ?? "tugas"} gagal${payload.error ? `: ${payload.error}` : ""}`
    : eventType === "agent.run.cancelled" ? `Run ${tr.agentName} untuk ${tr.identifier ?? "tugas"} dibatalkan`
    : null;
  return text ? { id: newId(), at: iso(), role: "office", text, issueId: payload.issueId, issueIdentifier: tr.identifier, agentId: tr.agentId, agentName: tr.agentName } : null;
}

/** The only context an agent gets: this one request, never the transcript. */
export function taskBrief(text: string): string {
  return [
    "Permintaan dari operator lewat Office Chat:",
    "",
    ...text.split("\n").map((l) => `> ${l}`),
    "",
    "Kerjakan permintaan ini, lalu tulis hasilnya sebagai komentar di issue ini (komentar akan diteruskan ke chat operator) dan ubah status issue sesuai hasil.",
    "Balas dalam Bahasa Indonesia, singkat dan langsung ke inti. Kalau ini hanya pertanyaan atau obrolan, cukup jawab di komentar lalu tandai issue selesai.",
  ].join("\n");
}
