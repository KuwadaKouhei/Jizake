import { describe, expect, it } from "vitest";

import { findPrefectureByCode, PREFECTURES } from "@/lib/constants/prefectures";

describe("PREFECTURES", () => {
  it("JIS 都道府県 47 件を持つ", () => {
    expect(PREFECTURES).toHaveLength(47);
  });

  it("コードは 01〜47 の 2 桁ゼロ埋めで重複しない", () => {
    const codes = PREFECTURES.map((prefecture) => prefecture.code);
    expect(new Set(codes).size).toBe(47);
    for (const code of codes) {
      expect(code).toMatch(/^(0[1-9]|[1-3][0-9]|4[0-7])$/);
    }
  });

  it("コードが JIS の並び順（昇順）になっている", () => {
    const codes = PREFECTURES.map((prefecture) => Number(prefecture.code));
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
  });
});

describe("findPrefectureByCode", () => {
  it("存在するコードは都道府県を返す", () => {
    expect(findPrefectureByCode("01")?.name).toBe("北海道");
    expect(findPrefectureByCode("35")?.name).toBe("山口県");
    expect(findPrefectureByCode("47")?.name).toBe("沖縄県");
  });

  it("存在しないコードは undefined を返す", () => {
    expect(findPrefectureByCode("48")).toBeUndefined();
    expect(findPrefectureByCode("1")).toBeUndefined();
    expect(findPrefectureByCode("")).toBeUndefined();
  });
});
