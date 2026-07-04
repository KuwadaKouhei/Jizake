import { describe, expect, it } from "vitest";

import { extractPrefectureCode, extractTagNames } from "./extract-conditions";

/**
 * クエリ自然文からの粗い条件抽出（純関数）のユニットテスト。
 * retriever が「渡された条件＋クエリ文字列」で動く最小限の抽出を担保する（DESIGN §2.6）。
 */

describe("extractTagNames", () => {
  const known = ["辛口", "甘口", "華やか", "淡麗"];

  it("自然文に含まれる既知タグを部分一致で拾う", () => {
    expect(extractTagNames("辛口でキレのある華やかなお酒", known)).toEqual([
      "辛口",
      "華やか",
    ]);
  });

  it("含まれないタグは拾わない", () => {
    expect(extractTagNames("すっきりした飲み口が好き", known)).toEqual([]);
  });

  it("返り値は knownTagNames の順序を保つ", () => {
    // 文中は「華やか」が先に出るが、known の順（辛口→華やか）で返る
    expect(extractTagNames("華やかで辛口", known)).toEqual(["辛口", "華やか"]);
  });

  it("空文字・空白のみのタグ名は無視する（誤って全一致しない）", () => {
    expect(extractTagNames("なんでもよい", ["", "  ", "辛口"])).toEqual([]);
  });

  it("重複する既知タグ名は 1 件に畳む", () => {
    expect(extractTagNames("辛口", ["辛口", "辛口"])).toEqual(["辛口"]);
  });
});

describe("extractPrefectureCode", () => {
  it("フル県名で一致する", () => {
    expect(extractPrefectureCode("山口県のお酒が飲みたい")).toBe("35");
  });

  it("「県/都/府/道」を落とした基底名でも一致する", () => {
    expect(extractPrefectureCode("山口の地酒")).toBe("35");
    expect(extractPrefectureCode("京都のお酒")).toBe("26");
    expect(extractPrefectureCode("東京で造られた酒")).toBe("13");
    expect(extractPrefectureCode("北海道の酒")).toBe("01");
  });

  it("県名が無ければ undefined", () => {
    expect(extractPrefectureCode("辛口が好き")).toBeUndefined();
  });

  it("複数県が含まれても JIS コード順で先勝ち（単一を返す）", () => {
    // 青森(02) と 山口(35) を含む → 先に来る青森
    expect(extractPrefectureCode("青森と山口で迷う")).toBe("02");
  });
});
