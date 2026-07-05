import { describe, expect, it } from "vitest";

import { parseBoldSegments } from "./bold-segments";

describe("parseBoldSegments", () => {
  it("`**〜**` を太字セグメントにし、記号は残さない", () => {
    expect(parseBoldSegments("おすすめは **辛口** です")).toEqual([
      { text: "おすすめは ", bold: false },
      { text: "辛口", bold: true },
      { text: " です", bold: false },
    ]);
  });

  it("記法が無ければ全文 1 セグメント", () => {
    expect(parseBoldSegments("こんばんは")).toEqual([
      { text: "こんばんは", bold: false },
    ]);
  });

  it("複数の太字を扱える", () => {
    expect(parseBoldSegments("**甘口**か**辛口**か")).toEqual([
      { text: "甘口", bold: true },
      { text: "か", bold: false },
      { text: "辛口", bold: true },
      { text: "か", bold: false },
    ]);
  });

  it("閉じが無い（生成途中の）`**` は以降を太字として扱い記号を出さない", () => {
    expect(parseBoldSegments("おすすめは **辛")).toEqual([
      { text: "おすすめは ", bold: false },
      { text: "辛", bold: true },
    ]);
  });

  it("空文字は空配列", () => {
    expect(parseBoldSegments("")).toEqual([]);
  });
});
