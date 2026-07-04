import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildEmbeddingText,
  computeSourceHash,
  type EmbeddingSource,
} from "./embedding";

/**
 * 埋め込み対象テキスト組み立て・sourceHash の純関数テスト（TASKS T11 ⑤）。
 *
 * 実 API（embedText / embedTexts）はここでは叩かない（TEST_PHILOSOPHY: LLM/埋め込み
 * API はモック・注入で扱う）。テキスト構成と差分判定の基準が安定していることを検証する。
 */

const base: EmbeddingSource = {
  name: "獺祭 純米大吟醸",
  breweryName: "旭酒造",
  prefectureCode: "35", // 山口県
  description: "華やかな香りと繊細な味わい。",
  tagNames: ["純米大吟醸", "華やか"],
};

describe("buildEmbeddingText", () => {
  it("銘柄名・蔵元・都道府県名・説明・タグを 1 テキストに組み立てる", () => {
    const text = buildEmbeddingText(base);
    expect(text).toContain("銘柄: 獺祭 純米大吟醸");
    expect(text).toContain("蔵元: 旭酒造");
    // 都道府県コード 35 → 山口県 に解決される
    expect(text).toContain("都道府県: 山口県");
    expect(text).toContain("説明: 華やかな香りと繊細な味わい。");
    expect(text).toContain("タグ: ");
    expect(text).toContain("純米大吟醸");
    expect(text).toContain("華やか");
  });

  it("同一入力に対して決定的（毎回同じテキスト）", () => {
    expect(buildEmbeddingText(base)).toBe(buildEmbeddingText(base));
  });

  it("タグの並び順が違っても同一テキストになる（名前順に正規化）", () => {
    const reordered: EmbeddingSource = {
      ...base,
      tagNames: ["華やか", "純米大吟醸"],
    };
    expect(buildEmbeddingText(reordered)).toBe(buildEmbeddingText(base));
  });

  it("タグが無い場合はタグ行を省く", () => {
    const text = buildEmbeddingText({ ...base, tagNames: [] });
    expect(text).not.toContain("タグ:");
    expect(text).toContain("説明: ");
  });

  it("都道府県コードが未知（解決不能）なら都道府県行を省く", () => {
    const text = buildEmbeddingText({ ...base, prefectureCode: "99" });
    expect(text).not.toContain("都道府県:");
  });
});

describe("computeSourceHash", () => {
  it("SHA-256 の hex（64 文字）を返す", () => {
    const hash = computeSourceHash("hello");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // 参照実装と一致する
    expect(hash).toBe(
      createHash("sha256").update("hello", "utf8").digest("hex"),
    );
  });

  it("同一入力→同一ハッシュ（差分判定の安定性）", () => {
    const text = buildEmbeddingText(base);
    expect(computeSourceHash(text)).toBe(computeSourceHash(text));
  });

  it("テキストが変われば別ハッシュになる（変化検知）", () => {
    const before = computeSourceHash(buildEmbeddingText(base));
    const after = computeSourceHash(
      buildEmbeddingText({ ...base, description: "辛口でキレのある味わい。" }),
    );
    expect(after).not.toBe(before);
  });

  it("説明文以外（タグ）の変化も別ハッシュになる", () => {
    const before = computeSourceHash(buildEmbeddingText(base));
    const after = computeSourceHash(
      buildEmbeddingText({
        ...base,
        tagNames: ["純米大吟醸", "華やか", "辛口"],
      }),
    );
    expect(after).not.toBe(before);
  });
});
