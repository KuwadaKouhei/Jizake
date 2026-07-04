import { describe, expect, it } from "vitest";

import { PREFECTURES } from "@/lib/constants/prefectures";

import { groupPrefecturesByRegion } from "./regions";

describe("groupPrefecturesByRegion", () => {
  it("47 都道府県を過不足なく地方に振り分ける", () => {
    const regions = groupPrefecturesByRegion();
    const grouped = regions.flatMap((region) => region.prefectures);

    // 総数が 47 で、コード集合が PREFECTURES と一致する（重複・欠落なし）
    expect(grouped).toHaveLength(PREFECTURES.length);
    expect(new Set(grouped.map((p) => p.code))).toEqual(
      new Set(PREFECTURES.map((p) => p.code)),
    );
  });

  it("各地方が少なくとも 1 県を含む（空の地方を作らない）", () => {
    for (const region of groupPrefecturesByRegion()) {
      expect(region.prefectures.length).toBeGreaterThan(0);
    }
  });

  it("代表的な県が想定する地方に入る", () => {
    const regions = groupPrefecturesByRegion();
    const regionOf = (name: string) =>
      regions.find((r) => r.prefectures.some((p) => p.name === name))?.name;

    expect(regionOf("北海道")).toBe("北海道・東北");
    expect(regionOf("東京都")).toBe("関東");
    expect(regionOf("新潟県")).toBe("中部");
    expect(regionOf("山口県")).toBe("中国");
    expect(regionOf("沖縄県")).toBe("九州・沖縄");
  });
});
