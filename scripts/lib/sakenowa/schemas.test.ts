import { describe, expect, it } from "vitest";

import areasFixture from "./fixtures/areas.json";
import brandFlavorTagsFixture from "./fixtures/brand-flavor-tags.json";
import brandsFixture from "./fixtures/brands.json";
import breweriesFixture from "./fixtures/breweries.json";
import flavorChartsFixture from "./fixtures/flavor-charts.json";
import flavorTagsFixture from "./fixtures/flavor-tags.json";
import rankingsFixture from "./fixtures/rankings.json";
import {
  areasResponseSchema,
  brandFlavorTagsResponseSchema,
  brandsResponseSchema,
  breweriesResponseSchema,
  flavorChartsResponseSchema,
  flavorTagsResponseSchema,
  rankingsResponseSchema,
} from "./schemas";

/**
 * 実 API レスポンスのフィクスチャ（fixtures/README.md 参照）が Zod スキーマを
 * 通ることを検証する。API 仕様が変わったら、フィクスチャを取得し直した時点で
 * このテストが落ちて検知できる（TEST_PHILOSOPHY のフィクスチャ方針）。
 */
describe("さけのわ API スキーマ × 実レスポンスフィクスチャ", () => {
  it("/areas — id 0（その他）と JIS コード 1〜47 を含む", () => {
    const { areas } = areasResponseSchema.parse(areasFixture);
    const ids = new Set(areas.map((area) => area.id));
    expect(ids.has(0)).toBe(true);
    for (let code = 1; code <= 47; code++) {
      expect(ids.has(code), `areaId ${code} が存在すること`).toBe(true);
    }
  });

  it("/breweries — areaId=0 と空文字名の蔵元（例外ケース）を含む", () => {
    const { breweries } = breweriesResponseSchema.parse(breweriesFixture);
    expect(breweries.length).toBeGreaterThan(0);
    expect(breweries.some((b) => b.areaId === 0)).toBe(true);
    expect(breweries.some((b) => b.name.trim() === "")).toBe(true);
  });

  it("/brands — 全銘柄が名前と蔵元 ID を持つ", () => {
    const { brands } = brandsResponseSchema.parse(brandsFixture);
    expect(brands.length).toBeGreaterThan(0);
  });

  it("/flavor-charts — 6 軸が 0..1 の範囲に収まる", () => {
    const { flavorCharts } =
      flavorChartsResponseSchema.parse(flavorChartsFixture);
    expect(flavorCharts.length).toBeGreaterThan(0);
  });

  it("/flavor-tags — タグ語彙マスタ", () => {
    const { tags } = flavorTagsResponseSchema.parse(flavorTagsFixture);
    expect(tags.length).toBeGreaterThan(0);
  });

  it("/brand-flavor-tags — 空配列の銘柄（タグなし扱い）を含む", () => {
    const { flavorTags } = brandFlavorTagsResponseSchema.parse(
      brandFlavorTagsFixture,
    );
    expect(flavorTags.some((entry) => entry.tagIds.length === 0)).toBe(true);
  });

  it("/rankings — 月次スナップショット（yearMonth + overall + areas）", () => {
    const rankings = rankingsResponseSchema.parse(rankingsFixture);
    expect(rankings.overall.length).toBeGreaterThan(0);
    expect(rankings.areas.length).toBeGreaterThan(0);
  });
});
