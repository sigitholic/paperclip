import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { classifyFailure, codexHomeFor, excerpt, listedCodexModels, readCodexFailure } from "../lib/model-probe.mjs";
import { parseTiers } from "../lib/tier-cli.mjs";
import { listGatewayModels } from "../scripts/model-tiers-check.mjs";

const SPAN = `session_loop{thread_id=01a0}:turn{otel.name="session_task.turn" ${"x".repeat(400)}}: `;

describe("classifyFailure", () => {
  it("recognises plan, quota and auth failures", () => {
    expect(classifyFailure("The model `gpt-5.5` does not exist or you do not have access to it.")).toBe("model_not_allowed");
    expect(classifyFailure("You've hit your usage limit")).toBe("usage_limit");
    expect(classifyFailure("401 Unauthorized")).toBe("auth");
    expect(classifyFailure("terminal service failure")).toBe("unknown");
    expect(classifyFailure(null)).toBe("unknown");
  });
});

describe("excerpt", () => {
  it("skips the tracing-span prefix and keeps the error", () => {
    const out = excerpt(`${SPAN}stream error: The model \`gpt-5.5\` does not exist or you do not have access to it.`);
    expect(out).toContain("does not exist or you do not have access");
    expect(out.length).toBeLessThanOrEqual(300);
  });
});

describe("9router options", () => {
  it("parses --tiers and rejects incomplete maps", () => {
    expect(parseTiers("fast=kr/glm-5, standard=my-combo,reasoning=cc/claude-opus-4-7")).toEqual({ fast: "kr/glm-5", standard: "my-combo", reasoning: "cc/claude-opus-4-7" });
    expect(parseTiers(undefined)).toBeNull();
    expect(() => parseTiers("fast=a,standard=b")).toThrow(/reasoning/);
  });

  it("lists gateway models with a bearer key and keeps the key out of errors", async () => {
    const seen = [];
    const ok = async (url, init) => { seen.push([url, init.headers.authorization]); return new Response(JSON.stringify({ data: [{ id: "kr/glm-5" }, { id: "my-combo" }] })); };
    expect(await listGatewayModels("http://r/v1", "sk-test", ok)).toEqual(["kr/glm-5", "my-combo"]);
    expect(seen).toEqual([["http://r/v1/models", "Bearer sk-test"]]);
    const denied = async () => new Response("nope", { status: 401 });
    await expect(listGatewayModels("http://r/v1", "sk-test", denied)).rejects.toThrow(/401/);
    await expect(listGatewayModels("http://r/v1", "sk-test", denied)).rejects.not.toThrow(/sk-test/);
  });
});

describe("codex home", () => {
  it("follows PAPERCLIP_HOME and PAPERCLIP_INSTANCE_ID", () => {
    expect(codexHomeFor("c1", { PAPERCLIP_HOME: "/h", PAPERCLIP_INSTANCE_ID: "dev" }).replaceAll("\\", "/")).toBe("/h/instances/dev/companies/c1/codex-home");
  });

  it("lists only advertised models and reads the newest matching failure", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-home-"));
    writeFileSync(join(home, "models_cache.json"), JSON.stringify({
      models: [{ slug: "gpt-6-luna", visibility: "list" }, { slug: "gpt-reserve", visibility: "hide" }, { slug: "gpt-5.5", visibility: "list" }],
    }));
    expect(listedCodexModels(home)).toEqual(["gpt-6-luna", "gpt-5.5"]);

    const db = new DatabaseSync(join(home, "logs_2.sqlite"));
    db.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, level TEXT, feedback_log_body TEXT)");
    const insert = db.prepare("INSERT INTO logs (ts, level, feedback_log_body) VALUES (?, ?, ?)");
    insert.run(100, "WARN", `${SPAN}gpt-5.5 old failure: does not exist or you do not have access`);
    insert.run(2_000, "INFO", "gpt-5.5 turn started");
    insert.run(2_001, "WARN", `${SPAN}The model \`gpt-5.5\` does not exist or you do not have access to it.`);
    db.close();

    expect(readCodexFailure(home, "gpt-5.5", 1_999_000)).toContain("does not exist or you do not have access");
    expect(readCodexFailure(home, "gpt-5.5", 3_000_000)).toBeNull();
    expect(readCodexFailure(join(home, "missing"), "gpt-5.5", 0)).toBeNull();
  });
});
