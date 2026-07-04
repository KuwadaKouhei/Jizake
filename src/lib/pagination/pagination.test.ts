import { describe, expect, it } from "vitest";

import { parsePageParam, totalPageCount } from "./pagination";

describe("parsePageParam", () => {
  it("正の整数文字列をそのまま数値にする", () => {
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("2")).toBe(2);
    expect(parsePageParam("100")).toBe(100);
  });

  it("undefined・0・負数・小数・非数・空文字はすべて 1 に丸める", () => {
    for (const raw of [undefined, "0", "-1", "2.5", "abc", "2abc", ""]) {
      expect(parsePageParam(raw)).toBe(1);
    }
  });

  it("配列（同名パラメータ複数指定）は先頭要素を採用する", () => {
    expect(parsePageParam(["3", "9"])).toBe(3);
    expect(parsePageParam(["bad"])).toBe(1);
  });

  it("上限（10000）を超える巨大 page は上限に丸める（巨大 OFFSET の DoS を防ぐ）", () => {
    expect(parsePageParam("10000")).toBe(10000);
    expect(parsePageParam("10001")).toBe(10000);
    expect(parsePageParam("999999999")).toBe(10000);
  });
});

describe("totalPageCount", () => {
  it("総件数を 1 ページ件数で切り上げる", () => {
    expect(totalPageCount(24, 24)).toBe(1);
    expect(totalPageCount(25, 24)).toBe(2);
    expect(totalPageCount(48, 24)).toBe(2);
    expect(totalPageCount(49, 24)).toBe(3);
  });

  it("0 件でも最低 1 ページを返す", () => {
    expect(totalPageCount(0, 24)).toBe(1);
    expect(totalPageCount(-5, 24)).toBe(1);
  });
});
