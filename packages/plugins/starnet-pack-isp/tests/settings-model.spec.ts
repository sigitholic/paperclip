import { describe, expect, it } from "vitest";
import { configFromDraft, draftFromConfig, emptyRouter, tlsIsFixed, transportLabel, validateRouter } from "../src/ui/settings-model.js";
import { mikrotikRouters } from "../src/sources.js";

const ref = (secretId: string) => ({ type: "secret_ref", secretId });

describe("settings model", () => {
  const legacy = {
    mikrotikHost: "192.168.36.32",
    mikrotikPort: 8728,
    mikrotikProtocol: "api",
    mikrotikUseTls: false,
    mikrotikUsername: "noc",
    mikrotikPassword: ref("s-main"),
    mikrotikRouters: [{ name: "bras-2", host: "10.0.0.2", port: 8729, username: "ro", password: ref("s-bras"), tlsVerify: false }],
    genieacsBaseUrl: "http://acs:7557",
    genieacsPassword: ref("s-acs"),
    timeoutMs: 8000,
    futureKey: "kept",
  } as const;

  it("shows the flat router first as 'default', then the extra routers", () => {
    const d = draftFromConfig(legacy as never);
    expect(d.routers.map((r) => [r.name, r.host, r.port, r.passwordSecretId])).toEqual([
      ["default", "192.168.36.32", "8728", "s-main"],
      ["bras-2", "10.0.0.2", "8729", "s-bras"],
    ]);
    expect(d.routers[1]!.tlsVerify).toBe(false);
    expect(d.genieacsPasswordSecretId).toBe("s-acs");
  });

  it("writes every router to mikrotikRouters, drops the flat fields, keeps unknown keys", () => {
    const out = configFromDraft(legacy as never, draftFromConfig(legacy as never));
    expect(Object.keys(out).filter((k) => k.startsWith("mikrotik"))).toEqual(["mikrotikRouters"]);
    expect(out.mikrotikRouters).toEqual([
      { name: "default", host: "192.168.36.32", protocol: "api", port: 8728, useTls: false, username: "noc", password: ref("s-main") },
      { name: "bras-2", host: "10.0.0.2", port: 8729, tlsVerify: false, username: "ro", password: ref("s-bras") },
    ]);
    expect(out).toMatchObject({ genieacsBaseUrl: "http://acs:7557", genieacsPassword: ref("s-acs"), timeoutMs: 8000, futureKey: "kept" });
    // The worker reads the saved shape the same way: same names, own secret path per router.
    expect(mikrotikRouters(out as never).map((r) => [r.name, r.passwordPath])).toEqual([
      ["default", "mikrotikRouters.0.password"],
      ["bras-2", "mikrotikRouters.1.password"],
    ]);
  });

  it("clears optional fields left empty", () => {
    const d = draftFromConfig({});
    d.routers.push({ ...emptyRouter(), name: "r1", host: "10.0.0.1", port: "" });
    expect(configFromDraft({ genieacsBaseUrl: "old" }, d)).toEqual({ mikrotikRouters: [{ name: "r1", host: "10.0.0.1" }] });
  });

  it("validates names, host and port", () => {
    const other = { ...emptyRouter(), name: "a", host: "x" };
    expect(validateRouter({ ...emptyRouter(), name: "a", host: "y" }, [other])).toEqual(['Nama "a" sudah dipakai']);
    expect(validateRouter({ ...emptyRouter(), name: "bad name", host: "" }, [])).toEqual([
      "Nama hanya huruf, angka, titik, minus, garis bawah",
      "Host wajib diisi",
    ]);
    expect(validateRouter({ ...emptyRouter(), name: "ok", host: "h", port: "70000" }, [])).toEqual(["Port tidak valid"]);
  });

  it("labels the transport and fixes TLS on the API ports", () => {
    expect(transportLabel({ ...emptyRouter(), port: "8728" })).toBe("API 8728");
    expect(transportLabel({ ...emptyRouter(), port: "8729" })).toBe("API+TLS 8729");
    expect(transportLabel({ ...emptyRouter(), port: "" })).toBe("REST+TLS 443");
    expect(tlsIsFixed({ ...emptyRouter(), port: "8729" })).toBe(true);
    expect(tlsIsFixed({ ...emptyRouter(), port: "443" })).toBe(false);
  });
});
