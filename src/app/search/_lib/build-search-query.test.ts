import { describe, expect, it } from "vitest";

import { buildSearchCriteria, isEmptyCriteria } from "./build-search-query";

describe("buildSearchCriteria", () => {
  it("空の searchParams は全条件なし・page=1 に正規化する（全件表示へ）", () => {
    const criteria = buildSearchCriteria({});
    expect(criteria).toEqual({
      q: undefined,
      prefectureCode: undefined,
      tagNames: [],
      page: 1,
    });
    expect(isEmptyCriteria(criteria)).toBe(true);
  });

  it("名前 q をトリムして取り込む（前後空白除去）", () => {
    expect(buildSearchCriteria({ q: "  獺祭  " }).q).toBe("獺祭");
  });

  it("空文字・空白のみの q は undefined（条件なし）に倒す", () => {
    expect(buildSearchCriteria({ q: "" }).q).toBeUndefined();
    expect(buildSearchCriteria({ q: "   " }).q).toBeUndefined();
  });

  it("長すぎる q は上限長で切り詰める（DoS 防止の境界制限）", () => {
    const long = "あ".repeat(500);
    const q = buildSearchCriteria({ q: long }).q;
    expect(q?.length).toBe(100);
  });

  it("正しい JIS コードの prefecture を受理する", () => {
    expect(buildSearchCriteria({ prefecture: "35" }).prefectureCode).toBe("35");
    expect(buildSearchCriteria({ prefecture: "01" }).prefectureCode).toBe("01");
    expect(buildSearchCriteria({ prefecture: "47" }).prefectureCode).toBe("47");
  });

  it("範囲外・書式外の prefecture は undefined に倒す（不正値は無視）", () => {
    for (const bad of ["00", "48", "99", "5", "abc", "3.5", ""]) {
      expect(buildSearchCriteria({ prefecture: bad }).prefectureCode).toBe(
        undefined,
      );
    }
  });

  it("tags は単一指定でも配列に正規化する（?tags=辛口）", () => {
    expect(buildSearchCriteria({ tags: "辛口" }).tagNames).toEqual(["辛口"]);
  });

  it("tags は複数指定（配列）を受け取り、トリム・空除去・重複除去する", () => {
    expect(
      buildSearchCriteria({ tags: ["辛口", " 淡麗 ", "", "辛口"] }).tagNames,
    ).toEqual(["辛口", "淡麗"]);
  });

  it("page を 1 始まりの整数に丸める（不正値は 1）", () => {
    expect(buildSearchCriteria({ page: "3" }).page).toBe(3);
    for (const bad of ["0", "-1", "2.5", "abc", ""]) {
      expect(buildSearchCriteria({ page: bad }).page).toBe(1);
    }
  });

  it("同名パラメータの配列（q・prefecture）は先頭要素を採用する", () => {
    expect(buildSearchCriteria({ q: ["獺祭", "久保田"] }).q).toBe("獺祭");
    expect(
      buildSearchCriteria({ prefecture: ["35", "15"] }).prefectureCode,
    ).toBe("35");
  });

  it("複合条件（名前×都道府県×タグ×page）をまとめて正規化する", () => {
    const criteria = buildSearchCriteria({
      q: "純米",
      prefecture: "15",
      tags: ["辛口", "淡麗"],
      page: "2",
    });
    expect(criteria).toEqual({
      q: "純米",
      prefectureCode: "15",
      tagNames: ["辛口", "淡麗"],
      page: 2,
    });
    expect(isEmptyCriteria(criteria)).toBe(false);
  });
});

describe("isEmptyCriteria", () => {
  it("page 以外の条件が一つでもあれば空でない", () => {
    expect(
      isEmptyCriteria({ q: "獺祭", tagNames: [], page: 1 }),
    ).toBe(false);
    expect(
      isEmptyCriteria({ prefectureCode: "35", tagNames: [], page: 1 }),
    ).toBe(false);
    expect(
      isEmptyCriteria({ tagNames: ["辛口"], page: 1 }),
    ).toBe(false);
  });

  it("q・prefecture・tags がすべて空なら（page が 2 でも）空条件とみなす", () => {
    expect(isEmptyCriteria({ tagNames: [], page: 2 })).toBe(true);
  });
});
