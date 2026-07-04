import { describe, expect, it } from "vitest";

import { recommendReasonLabel } from "./recommend-reason-label";

describe("recommendReasonLabel", () => {
  it("フォールバックは『人気の銘柄』", () => {
    expect(recommendReasonLabel({ kind: "popular" })).toBe("人気の銘柄");
  });

  it("タグ根拠を『よく見ている「辛口」から』にする", () => {
    expect(
      recommendReasonLabel({
        kind: "history",
        signals: [{ type: "tag", label: "辛口" }],
      }),
    ).toBe("よく見ている「辛口」から");
  });

  it("都道府県コードを県名に変換して並べる", () => {
    expect(
      recommendReasonLabel({
        kind: "history",
        signals: [
          { type: "tag", label: "辛口" },
          { type: "prefecture", code: "35" },
        ],
      }),
    ).toBe("よく見ている「辛口」「山口県」から");
  });

  it("シグナルは上限 2 件まで（ノイズ抑制）", () => {
    const label = recommendReasonLabel({
      kind: "history",
      signals: [
        { type: "tag", label: "辛口" },
        { type: "tag", label: "淡麗" },
        { type: "tag", label: "華やか" },
      ],
    });
    expect(label).toBe("よく見ている「辛口」「淡麗」から");
    expect(label).not.toContain("華やか");
  });

  it("表示できる根拠が無ければ汎用文言に倒す", () => {
    expect(recommendReasonLabel({ kind: "history", signals: [] })).toBe(
      "あなたの履歴から",
    );
  });
});
