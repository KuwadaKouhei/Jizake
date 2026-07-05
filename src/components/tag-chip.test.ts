import { describe, expect, it } from "vitest";

import { tagChipClassName } from "@/components/tag-chip";

/**
 * タグチップ配色の対応テスト。
 * 代表的な味わいタグが意味に沿った色になり、未知の名前・種別タグは
 * 藍系デフォルトへ倒れることを確認する（さけのわ由来の任意タグ名で壊れない）。
 */
describe("tagChipClassName", () => {
  it("代表的な味わいタグは意味に合わせた配色になる", () => {
    expect(tagChipClassName({ name: "甘口", category: "taste" })).toContain(
      "#a55744",
    );
    expect(tagChipClassName({ name: "辛口", category: "taste" })).toContain(
      "#33608f",
    );
    expect(tagChipClassName({ name: "淡麗", category: "taste" })).toContain(
      "#5d7a4e",
    );
    expect(tagChipClassName({ name: "旨口", category: "taste" })).toContain(
      "#8f7a3c",
    );
  });

  it("未知の味わいタグ名は藍系デフォルトに倒す", () => {
    expect(tagChipClassName({ name: "未知の味", category: "taste" })).toContain(
      "#4a6285",
    );
  });

  it("種別タグ（type）は名前によらず藍系で統一する", () => {
    expect(
      tagChipClassName({ name: "純米大吟醸", category: "type" }),
    ).toContain("#4a6285");
    // 味わいと同名でもカテゴリが type なら藍系。
    expect(tagChipClassName({ name: "甘口", category: "type" })).toContain(
      "#4a6285",
    );
  });
});
