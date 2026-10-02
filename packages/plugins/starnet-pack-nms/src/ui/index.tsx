import { usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import type { Severity } from "../model.js";

export { SettingsPage } from "./settings.js";

type Summary = { open: number; counts: Record<Severity, number>; suppressedThisHour: number };

const ORDER: Severity[] = ["disaster", "high", "average", "warning", "info"];

export function NmsWidget({ context }: PluginWidgetProps) {
  const { data, loading, error } = usePluginData<Summary>("alert-summary", { companyId: context.companyId });
  if (loading) return <div>Loading NMS alerts…</div>;
  if (error) return <div>NMS alerts error: {error.message}</div>;
  if (!data) return null;
  const parts = ORDER.filter((sev) => data.counts[sev]).map((sev) => `${sev} ${data.counts[sev]}`);
  return (
    <div style={{ display: "grid", gap: "0.25rem" }}>
      <strong>NMS alerts</strong>
      <div>Open alert issues: {data.open}</div>
      {parts.length ? <div>{parts.join(" · ")}</div> : <div>No open alerts.</div>}
      {data.suppressedThisHour ? <div>Suppressed this hour (rate limit): {data.suppressedThisHour}</div> : null}
    </div>
  );
}
