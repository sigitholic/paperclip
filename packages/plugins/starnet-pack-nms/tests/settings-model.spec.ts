import { describe, expect, it } from "vitest";
import {
  configFromDraft,
  draftFromConfig,
  emptySource,
  libreTemplate,
  validateSettings,
  validateSource,
  webhookUrl,
  zabbixTemplate,
} from "../src/ui/settings-model.js";

const ref = (secretId: string) => ({ type: "secret_ref", secretId });

describe("settings model", () => {
  it("round-trips config and keeps unknown keys", () => {
    const config = {
      nmsSources: [{ name: "zbx", kind: "zabbix", baseUrl: "https://z/zabbix", token: ref("s1") }, { kind: "librenms", baseUrl: "https://l" }],
      webhookToken: ref("wh"),
      alertMinSeverity: "high",
      futureKey: 1,
    };
    const draft = draftFromConfig(config as never);
    expect(draft.sources[1]).toEqual({ name: "librenms-2", kind: "librenms", baseUrl: "https://l", tokenSecretId: "" });
    expect(draft.alertMinSeverity).toBe("high");
    expect(configFromDraft(config, draft)).toEqual({
      futureKey: 1,
      nmsSources: [
        { name: "zbx", kind: "zabbix", baseUrl: "https://z/zabbix", token: ref("s1") },
        { name: "librenms-2", kind: "librenms", baseUrl: "https://l" },
      ],
      webhookToken: ref("wh"),
      alertMinSeverity: "high",
    });
  });

  it("clearing the webhook secret disables the webhook", () => {
    const draft = draftFromConfig({ webhookToken: ref("wh") } as never);
    expect(configFromDraft({ webhookToken: ref("wh") }, { ...draft, webhookSecretId: "" })).not.toHaveProperty("webhookToken");
  });

  it("validates sources and numbers", () => {
    expect(validateSource({ ...emptySource(), name: "a b", baseUrl: "z" }, [])).toEqual([
      "Nama hanya huruf, angka, titik, minus, garis bawah",
      "URL harus diawali http:// atau https://",
      "Token API wajib dipilih",
    ]);
    const ok = { name: "zbx", kind: "zabbix" as const, baseUrl: "https://z", tokenSecretId: "s" };
    expect(validateSource(ok, [ok])).toEqual(['Nama "zbx" sudah dipakai']);
    expect(validateSettings({ ...draftFromConfig({}), maxNewIssuesPerHour: "0", timeoutMs: "5" })).toHaveLength(2);
  });

  it("builds NMS templates with the webhook URL and company", () => {
    const url = webhookUrl("http://pc:3100/", "starnet.pack-nms", "alerts");
    expect(url).toBe("http://pc:3100/api/plugins/starnet.pack-nms/webhooks/alerts");
    const z = zabbixTemplate(url, "c1");
    expect(z.parameters).toContainEqual(["eventid", "{EVENT.ID}"]);
    expect(z.script).toContain("hmac('sha256', p.secret, body)");
    const l = libreTemplate(url, "c1");
    expect(l.headers).toContain("x-starnet-company=c1");
    expect(JSON.parse(l.body)).toMatchObject({ source: "librenms", status: "{{ $state }}" });
  });
});
