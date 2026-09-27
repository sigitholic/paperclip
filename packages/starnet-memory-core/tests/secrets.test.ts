import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { scrubSecrets } from "../src/index.ts";

describe("scrubSecrets", () => {
  const cases: Array<[string, string, string]> = [
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----", "private_key", "[REDACTED:private_key]"],
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N", "jwt", "[REDACTED:jwt]"],
    ["db postgres://paperclip:hunter2@127.0.0.1:5432/x", "url_credentials", "postgres://[REDACTED:credentials]@127.0.0.1"],
    ["key sk-ant-abcdefghijklmnopqrstuvwx", "provider_token", "[REDACTED:token]"],
    ["gh ghp_abcdefghijklmnopqrstuvwxyz0123", "provider_token", "[REDACTED:token]"],
    ["aws AKIAABCDEFGHIJKLMNOP", "provider_token", "[REDACTED:token]"],
    ["Authorization: Bearer abcdefghijklmnop1234", "bearer", "Bearer [REDACTED:token]"],
    ['api_key="abc123"', "key_value", "api_key=[REDACTED:secret]"],
    ["kata sandi adalah rahasia123", "key_value", "kata sandi adalah [REDACTED:secret]"],
    ["PASSWORD=foo", "key_value", "PASSWORD=[REDACTED:secret]"],
  ];
  for (const [input, type, expected] of cases) {
    test(type + ": " + input.slice(0, 20), () => {
      const r = scrubSecrets(input);
      assert.ok(r.text.includes(expected), r.text);
      assert.ok(r.types.includes(type), JSON.stringify(r.types));
      assert.ok(r.redactions >= 1);
    });
  }
  test("unterminated private key block is redacted to the end", () => {
    assert.equal(scrubSecrets("-----BEGIN PRIVATE KEY-----\nabc\ndef").text, "[REDACTED:private_key]");
  });
  test("idempotent and clean text untouched", () => {
    const once = scrubSecrets("password: abc, token=xyz");
    const twice = scrubSecrets(once.text);
    assert.equal(twice.text, once.text);
    assert.equal(twice.redactions, 0);
    assert.deepEqual(scrubSecrets("PPPoE aktif 812 sesi"), { text: "PPPoE aktif 812 sesi", redactions: 0, types: [] });
  });
});
