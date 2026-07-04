import { describe, expect, it } from "vitest";

import {
  buildSearchCriteria,
  isEmptyCriteria,
  sanitizeCriteria,
  toSearchQueryString,
} from "./index";

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

  it("tags は複数指定（配列）を受け取り、トリム・空除去・重複除去・ソートする", () => {
    // ソート後は UTF-16 コード順（淡 U+6DE1 < 辛 U+8F9B）で決定的になる。
    expect(
      buildSearchCriteria({ tags: ["辛口", " 淡麗 ", "", "辛口"] }).tagNames,
    ).toEqual(["淡麗", "辛口"]);
  });

  it("tags は指定順が違っても同じ集合なら同一表現に正規化する（決定性）", () => {
    const a = buildSearchCriteria({ tags: ["辛口", "淡麗"] }).tagNames;
    const b = buildSearchCriteria({ tags: ["淡麗", "辛口"] }).tagNames;
    expect(a).toEqual(b);
  });

  it("page を 1 始まりの整数に丸め、上限で頭打ちにする（不正値は 1）", () => {
    expect(buildSearchCriteria({ page: "3" }).page).toBe(3);
    for (const bad of ["0", "-1", "2.5", "abc", ""]) {
      expect(buildSearchCriteria({ page: bad }).page).toBe(1);
    }
    // 巨大 page は上限 10000 に丸める（巨大 OFFSET の DoS を防ぐ）
    expect(buildSearchCriteria({ page: "999999999" }).page).toBe(10000);
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
      tagNames: ["淡麗", "辛口"],
      page: 2,
    });
    expect(isEmptyCriteria(criteria)).toBe(false);
  });
});

describe("isEmptyCriteria", () => {
  it("page 以外の条件が一つでもあれば空でない", () => {
    expect(isEmptyCriteria({ q: "獺祭", tagNames: [], page: 1 })).toBe(false);
    expect(
      isEmptyCriteria({ prefectureCode: "35", tagNames: [], page: 1 }),
    ).toBe(false);
    expect(isEmptyCriteria({ tagNames: ["辛口"], page: 1 })).toBe(false);
  });

  it("q・prefecture・tags がすべて空なら（page が 2 でも）空条件とみなす", () => {
    expect(isEmptyCriteria({ tagNames: [], page: 2 })).toBe(true);
  });
});

describe("toSearchQueryString", () => {
  it("空の条件は空文字を返す（page=1 は省く）", () => {
    expect(toSearchQueryString({ tagNames: [], page: 1 })).toBe("");
  });

  it("q・prefecture・複数 tags を保持し、page 引数で上書きする", () => {
    const qs = toSearchQueryString(
      { q: "獺祭", prefectureCode: "35", tagNames: ["辛口", "淡麗"], page: 1 },
      2,
    );
    // クエリ順は URLSearchParams の挿入順（q → prefecture → tags → page）
    expect(qs).toBe(
      "?q=%E7%8D%BA%E7%A5%AD&prefecture=35&tags=%E8%BE%9B%E5%8F%A3&tags=%E6%B7%A1%E9%BA%97&page=2",
    );
  });

  it("page 引数を省くと criteria.page を使う（1 は省略）", () => {
    expect(toSearchQueryString({ q: "久保田", tagNames: [], page: 1 })).toBe(
      "?q=%E4%B9%85%E4%BF%9D%E7%94%B0",
    );
  });
});

describe("sanitizeCriteria", () => {
  it("クライアント由来の過大な criteria をサーバ側で再検証・クランプする", () => {
    const dirty = {
      q: "あ".repeat(500), // 100 文字上限
      prefectureCode: "99", // 不正コード → undefined
      tagNames: Array.from({ length: 50 }, (_, i) => `tag${i}`), // 20 件上限
      page: 3,
    };
    const clean = sanitizeCriteria(dirty);
    expect(clean.q?.length).toBe(100);
    expect(clean.prefectureCode).toBeUndefined();
    expect(clean.tagNames.length).toBe(20);
    expect(clean.page).toBe(3);
  });

  it("巨大なタグ名は 1 要素あたりの上限で切り詰める（jsonb 肥大化防止）", () => {
    const clean = sanitizeCriteria({
      tagNames: ["か".repeat(200)],
      page: 1,
    });
    expect(clean.tagNames[0].length).toBe(32);
  });

  it("正常な条件はそのまま保持する", () => {
    const clean = sanitizeCriteria({
      q: "獺祭",
      prefectureCode: "35",
      tagNames: ["辛口"],
      page: 2,
    });
    expect(clean).toEqual({
      q: "獺祭",
      prefectureCode: "35",
      tagNames: ["辛口"],
      page: 2,
    });
  });
});
