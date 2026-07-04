import { describe, expect, it } from "vitest";

import type { SearchHistoryEntry } from "./queries";
import {
  formatViewedAt,
  searchHistoryToHref,
  searchHistoryToLabels,
} from "./format";

function entry(query: string | null, filters: unknown): SearchHistoryEntry {
  return {
    id: "id",
    query,
    filters,
    searchedAt: new Date("2026-07-04T00:00:00Z"),
  };
}

describe("formatViewedAt", () => {
  it("UTC を JST（+9h）の YYYY/MM/DD HH:mm に整形する", () => {
    // 2026-07-04 15:30 UTC → JST 2026-07-05 00:30（日付繰り上がりも検証）。
    expect(formatViewedAt(new Date("2026-07-04T15:30:00Z"))).toBe(
      "2026/07/05 00:30",
    );
  });

  it("桁をゼロ埋めする", () => {
    expect(formatViewedAt(new Date("2026-01-02T00:05:00Z"))).toBe(
      "2026/01/02 09:05",
    );
  });
});

describe("searchHistoryToHref", () => {
  it("名前・都道府県・タグを /search のクエリ文字列に組み立てる", () => {
    const href = searchHistoryToHref(
      entry("獺祭", { prefectureCode: "35", tagNames: ["辛口", "淡麗"] }),
    );
    expect(href).toContain("/search?");
    expect(href).toContain("q=");
    expect(href).toContain("prefecture=35");
    expect(href).toContain("tags=");
  });

  it("空条件（query なし・filters 空）は /search（クエリなし）になる", () => {
    expect(searchHistoryToHref(entry(null, {}))).toBe("/search");
  });

  it("filters が想定外の形でも壊れず、拾える条件だけを使う", () => {
    // prefectureCode が数値・tagNames が非配列でも例外を投げない。
    const href = searchHistoryToHref(
      entry("久保田", { prefectureCode: 35, tagNames: "辛口" }),
    );
    expect(href).toContain("q=");
    expect(href).not.toContain("prefecture=");
    expect(href).not.toContain("tags=");
  });

  it("filters が null でも壊れない", () => {
    expect(searchHistoryToHref(entry("test", null))).toContain("q=");
  });
});

describe("searchHistoryToLabels", () => {
  it("名前・県名・タグをラベル片にする（県コードは県名に変換）", () => {
    const labels = searchHistoryToLabels(
      entry("獺祭", { prefectureCode: "35", tagNames: ["辛口"] }),
    );
    expect(labels).toEqual(["名前: 獺祭", "山口県", "辛口"]);
  });

  it("不正な県コードは表示しない", () => {
    const labels = searchHistoryToLabels(
      entry(null, { prefectureCode: "99", tagNames: [] }),
    );
    expect(labels).toEqual([]);
  });
});
