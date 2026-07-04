import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/models";

import { fakeEmbedText } from "./fake-embedding";

/**
 * 決定的ダミー埋め込みのテスト（TASKS T13②）。
 * 精度の絶対値は検証しない（無意味）。ハーネスが動くための最低条件だけ担保する:
 * 決定性・次元・単位ベクトル・空文字の安全性。
 */

describe("fakeEmbedText（決定的ダミー埋め込み）", () => {
  it("次元は EMBEDDING_DIMENSIONS（1536）", () => {
    expect(fakeEmbedText("華やかな純米大吟醸")).toHaveLength(
      EMBEDDING_DIMENSIONS,
    );
  });

  it("同じテキストは常に同じベクトル（決定的・再現可能）", () => {
    const a = fakeEmbedText("辛口でキレのある酒");
    const b = fakeEmbedText("辛口でキレのある酒");
    expect(a).toEqual(b);
  });

  it("異なるテキストは異なるベクトルになりうる", () => {
    const a = fakeEmbedText("華やかな吟醸香");
    const b = fakeEmbedText("濃醇で燗が映える");
    expect(a).not.toEqual(b);
  });

  it("L2 正規化された単位ベクトル（cosine 距離を安定させる）", () => {
    const v = fakeEmbedText("新潟の淡麗辛口");
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("空文字でもゼロ割せず有効な単位ベクトルを返す", () => {
    const v = fakeEmbedText("");
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});
