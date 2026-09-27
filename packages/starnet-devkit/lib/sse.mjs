// Tiny SSE subscriber for plugin streams (GET /api/plugins/:id/bridge/stream/:channel).
export function subscribe(base, pluginId, channel, companyId) {
  const events = [];
  const abort = new AbortController();
  const ready = (async () => {
    const res = await fetch(`${base}/api/plugins/${pluginId}/bridge/stream/${channel}?companyId=${companyId}`, { signal: abort.signal });
    if (res.status !== 200) throw new Error(`stream ${channel} -> HTTP ${res.status} (is core patch P-0 applied?)`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const type = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (type === "message" && data) { try { events.push({ ...JSON.parse(data), receivedAt: Date.now() }); } catch { /* ignore */ } }
          }
        }
      } catch { /* aborted */ }
    })();
    return res.status;
  })();
  return { events, ready, close: () => abort.abort() };
}
