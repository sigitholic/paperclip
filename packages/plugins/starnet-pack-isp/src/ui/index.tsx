import { usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";

type LastCheck = {
  checkedAt?: string;
  pppoe?: { mode: string; active: number };
  router?: { mode: string; cpuLoadPct: number; memUsedPct: number; uptime: string; board: string; total?: number; unreachable?: string[] };
  cpe?: { mode: string; total: number; online: number };
};

export function NocWidget({ context }: PluginWidgetProps) {
  const { data, loading, error } = usePluginData<LastCheck | null>("last-check", { companyId: context.companyId });
  if (loading) return <div>Loading NOC status…</div>;
  if (error) return <div>NOC status error: {error.message}</div>;
  if (!data?.checkedAt) return <div>No NOC check yet. Run the “Daily PPPoE check” routine.</div>;
  const mock = [data.pppoe, data.router, data.cpe].some((s) => s?.mode === "mock");
  return (
    <div style={{ display: "grid", gap: "0.25rem" }}>
      <strong>NOC status{mock ? " (MOCK data)" : ""}</strong>
      <div>Active PPPoE: {data.pppoe?.active ?? "–"}</div>
      <div>
        Router CPU / mem{(data.router?.total ?? 1) > 1 ? ` (max of ${data.router!.total})` : ""}:{" "}
        {data.router ? `${data.router.cpuLoadPct}% / ${data.router.memUsedPct}%` : "–"}
      </div>
      {data.router?.unreachable?.length ? <div>Unreachable: {data.router.unreachable.join(", ")}</div> : null}
      <div>CPE online: {data.cpe ? `${data.cpe.online} / ${data.cpe.total}` : "–"}</div>
      <small>Last check: {new Date(data.checkedAt).toLocaleString()}</small>
    </div>
  );
}
