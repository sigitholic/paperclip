import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clip, estimateTokens, hasInvisible, normalizeText, oneLine, stripMarkdown } from "../src/index.ts";

describe("text helpers", () => {
  test("clip", () => {
    assert.equal(clip("abcdef", 10), "abcdef");
    assert.equal(clip("abcdef", 4), "abc…");
    assert.equal(clip("abcdef", 1), "…");
    assert.equal(clip("abcdef", 0), "");
    assert.equal(clip("ab 😀cd", 5), "ab…"); // does not split the emoji surrogate pair
  });
  test("normalize, oneLine, invisible", () => {
    assert.equal(normalizeText("a\r\nb\u200B \u0007\n"), "a\nb");
    assert.equal(oneLine(" a \n b\t c "), "a b c");
    assert.ok(hasInvisible("x\uFEFF"));
    assert.equal(hasInvisible("plain"), false);
  });
  test("estimateTokens and stripMarkdown", () => {
    assert.equal(estimateTokens("abcde"), 2);
    assert.equal(estimateTokens(8), 2);
    assert.equal(stripMarkdown("## **Judul** `x`"), "Judul x");
    assert.equal(stripMarkdown("1) item"), "item");
  });
});
