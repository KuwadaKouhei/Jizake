import { describe, expect, it } from "vitest";

import {
  findPriceRangeLabel,
  PRICE_RANGES,
} from "@/lib/constants/price-ranges";

describe("PRICE_RANGES", () => {
  it("価格帯 3 区分を持つ", () => {
    expect(PRICE_RANGES).toHaveLength(3);
  });

  it("value は DATABASE.md の CHECK 制約（sakes.price_range）と一致し、重複しない", () => {
    const values = PRICE_RANGES.map((range) => range.value);
    expect(values).toEqual(["under_1500", "from_1500_to_3000", "over_3000"]);
    expect(new Set(values).size).toBe(3);
  });

  it("すべての区分に日本語の表示名（円表記）がある", () => {
    for (const range of PRICE_RANGES) {
      expect(range.label.length).toBeGreaterThan(0);
      expect(range.label).toContain("円");
    }
  });
});

describe("findPriceRangeLabel", () => {
  it("存在する値は表示名を返す", () => {
    expect(findPriceRangeLabel("under_1500")).toBe("〜1,500円");
    expect(findPriceRangeLabel("from_1500_to_3000")).toBe("1,500〜3,000円");
    expect(findPriceRangeLabel("over_3000")).toBe("3,000円〜");
  });

  it("存在しない値は undefined を返す", () => {
    expect(findPriceRangeLabel("unknown")).toBeUndefined();
    expect(findPriceRangeLabel("")).toBeUndefined();
  });
});
