// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SakeSummary } from "@/lib/db/queries/sakes";

// 一覧取得クエリは PGlite 統合テスト（sakes.test.ts）で担保済み。
// ここでは DB 接続を避け、表示ロジック・空状態・notFound() 分岐だけを検証する。
const { getSakesByPrefecture } = vi.hoisted(() => ({
  getSakesByPrefecture: vi.fn<(code: string) => Promise<SakeSummary[]>>(),
}));
vi.mock("@/lib/db/queries/sakes", () => ({ getSakesByPrefecture }));

const notFoundError = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw notFoundError;
  },
}));

import PrefectureSakesPage, { generateMetadata } from "./page";

const sake: SakeSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "獺祭 純米大吟醸 45",
  breweryName: "旭酒造",
  prefectureCode: "35",
  tags: [{ id: "t1", name: "純米大吟醸", category: "type", source: "manual" }],
};

async function renderPage(code: string) {
  const element = await PrefectureSakesPage({
    params: Promise.resolve({ code }),
  });
  const markup = renderToStaticMarkup(element);
  return new DOMParser().parseFromString(markup, "text/html");
}

beforeEach(() => {
  getSakesByPrefecture.mockReset();
});

describe("PrefectureSakesPage", () => {
  it("県名見出しと銘柄カード（詳細リンク付き）を表示する（FR-07）", async () => {
    getSakesByPrefecture.mockResolvedValue([sake]);

    const doc = await renderPage("35"); // 山口
    const text = doc.body.textContent ?? "";

    expect(doc.querySelector("h1")?.textContent).toContain("山口県の地酒");
    expect(text).toContain("獺祭 純米大吟醸 45");
    expect(text).toContain("旭酒造");
    // カードから詳細ページへ遷移できる
    expect(
      doc.querySelector('a[href="/sake/11111111-1111-4111-8111-111111111111"]'),
    ).not.toBeNull();
  });

  it("0 件のときは空状態メッセージを表示する", async () => {
    getSakesByPrefecture.mockResolvedValue([]);

    const doc = await renderPage("47"); // 沖縄
    const text = doc.body.textContent ?? "";

    expect(text).toContain("沖縄県");
    expect(text).toContain("まだ登録されていません");
    // カード（詳細リンク）は描画されない
    expect(doc.querySelector('a[href^="/sake/"]')).toBeNull();
  });

  it("47 都道府県コード以外は notFound() を呼ぶ（T06 ④）", async () => {
    await expect(renderPage("99")).rejects.toBe(notFoundError);
    await expect(renderPage("00")).rejects.toBe(notFoundError);
    await expect(renderPage("abc")).rejects.toBe(notFoundError);
    // 不正コードでは DB へ問い合わせない
    expect(getSakesByPrefecture).not.toHaveBeenCalled();
  });
});

describe("generateMetadata", () => {
  it("「〇〇県の地酒」をタイトルにする（T06 ②）", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ code: "35" }),
    });
    expect(meta.title).toBe("山口県の地酒");
  });

  it("不正なコードでは空のメタデータを返す（レイアウト既定に委ねる）", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ code: "99" }),
    });
    expect(meta.title).toBeUndefined();
  });
});
