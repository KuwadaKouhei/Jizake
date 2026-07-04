import { describe, expect, it } from "vitest";

import flavorChartsFixture from "./fixtures/flavor-charts.json";
import {
  FLAVOR_AXIS_TAGS,
  FLAVOR_TAG_THRESHOLD,
  flavorToTagNames,
} from "./flavor-to-tags";
import { flavorChartsResponseSchema } from "./schemas";

const zeroChart = { f1: 0, f2: 0, f3: 0, f4: 0, f5: 0, f6: 0 };

describe("flavorToTagNames", () => {
  it("しきい値以上の軸だけがタグになる", () => {
    expect(
      flavorToTagNames({ ...zeroChart, f1: 0.7, f5: 0.6, f6: 0.49 }, 0.5),
    ).toEqual(["華やか", "ドライ"]);
  });

  it("しきい値ちょうどの軸は付与される（境界値）", () => {
    expect(flavorToTagNames({ ...zeroChart, f2: 0.5 }, 0.5)).toEqual(["芳醇"]);
  });

  it("全軸がしきい値未満なら空配列を返す", () => {
    expect(flavorToTagNames(zeroChart)).toEqual([]);
  });

  it("全軸がしきい値以上なら 6 軸すべての公式名タグを軸順に返す", () => {
    const allHigh = { f1: 1, f2: 1, f3: 1, f4: 1, f5: 1, f6: 1 };
    expect(flavorToTagNames(allHigh)).toEqual([
      "華やか",
      "芳醇",
      "重厚",
      "穏やか",
      "ドライ",
      "軽快",
    ]);
  });

  it("しきい値は引数で注入できる（既定値は FLAVOR_TAG_THRESHOLD）", () => {
    const chart = { ...zeroChart, f3: 0.3 };
    expect(flavorToTagNames(chart, 0.2)).toEqual(["重厚"]);
    expect(flavorToTagNames(chart)).toEqual(
      flavorToTagNames(chart, FLAVOR_TAG_THRESHOLD),
    );
  });

  it("実 API フィクスチャの全銘柄で、結果は定義済みタグ名の部分集合になる", () => {
    const { flavorCharts } =
      flavorChartsResponseSchema.parse(flavorChartsFixture);
    expect(flavorCharts.length).toBeGreaterThan(0);

    const knownTagNames = new Set<string>(
      FLAVOR_AXIS_TAGS.map(({ tagName }) => tagName),
    );
    for (const chart of flavorCharts) {
      for (const tagName of flavorToTagNames(chart)) {
        expect(knownTagNames.has(tagName)).toBe(true);
      }
    }
    // しきい値が全銘柄を落とすほど高すぎないことの目安
    const tagged = flavorCharts.filter(
      (chart) => flavorToTagNames(chart).length > 0,
    );
    expect(tagged.length).toBeGreaterThan(0);
  });
});
