// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SakeDetail } from "@/lib/db/queries/sakes";

// 詳細取得クエリはこのページテストの対象外（PGlite 統合テストで担保済み）。
// DB 接続を避け、表示ロジックと notFound() 分岐だけを検証するためモックする。
// vi.mock はファイル先頭へ巻き上げられるため、モック関数は vi.hoisted で用意する。
const { getSakeDetail } = vi.hoisted(() => ({
  getSakeDetail: vi.fn<(id: string) => Promise<SakeDetail | null>>(),
}));
vi.mock("@/lib/db/queries/sakes", () => ({ getSakeDetail }));

// 閲覧記録トリガ（Client Component）はマウント時に Server Action → DB へ至るチェーンを
// 持つ。ページの表示ロジック検証では不要なうえ、Vitest は "use server"/"use client" 境界を
// 尊重せず client.ts のサーバ専用ガードに触れてしまうため、トリガをモックで無効化する
// （記録の挙動は record-view.test.ts / record-view-trigger.test.tsx で個別に検証）。
vi.mock("./_components/record-view-trigger", () => ({
  RecordViewTrigger: () => null,
}));

// next/navigation の notFound は例外を投げてレンダリングを中断する。挙動を再現する。
const notFoundError = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw notFoundError;
  },
}));

import SakeDetailPage, { generateMetadata } from "./page";

const fullSake: SakeDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "獺祭 純米大吟醸 45",
  breweryName: "旭酒造",
  prefectureCode: "35",
  tags: [{ id: "t1", name: "純米大吟醸", category: "type", source: "manual" }],
  reading: "だっさい",
  description: "自作の説明文。\n改行あり。",
  officialUrl: "https://example.com/dassai",
  amazonUrl: null,
  rakutenUrl: null,
  priceRange: "over_3000",
  flavor: {
    floral: 0.8,
    mellow: 0.4,
    heavy: 0.2,
    mild: 0.5,
    dry: 0.3,
    light: 0.7,
  },
};

async function renderPage(id: string) {
  const element = await SakeDetailPage({ params: Promise.resolve({ id }) });
  const markup = renderToStaticMarkup(element);
  return new DOMParser().parseFromString(markup, "text/html");
}

beforeEach(() => {
  getSakeDetail.mockReset();
});

describe("SakeDetailPage", () => {
  it("銘柄が存在すれば名称・蔵元・都道府県・価格帯・説明・タグ・フレーバー・外部リンクを表示する", async () => {
    getSakeDetail.mockResolvedValue(fullSake);

    const doc = await renderPage(fullSake.id);
    const text = doc.body.textContent ?? "";

    expect(doc.querySelector("h1")?.textContent).toBe("獺祭 純米大吟醸 45");
    expect(text).toContain("旭酒造");
    expect(text).toContain("山口県"); // prefectureCode 35
    expect(text).toContain("3,000円〜"); // price_range over_3000 のラベル
    expect(text).toContain("自作の説明文。");
    expect(text).toContain("純米大吟醸");
    expect(text).toContain("華やか"); // フレーバー軸ラベル
    // 公式リンクが別タブ＋ rel で描画される（FR-03）
    const official = doc.querySelector('a[href="https://example.com/dassai"]');
    expect(official?.getAttribute("target")).toBe("_blank");
    expect(official?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("存在しない銘柄は notFound() を呼ぶ（T05 ⑤）", async () => {
    getSakeDetail.mockResolvedValue(null);

    await expect(
      renderPage("99999999-9999-4999-8999-999999999999"),
    ).rejects.toBe(notFoundError);
  });
});

describe("generateMetadata", () => {
  it("銘柄名をタイトルにする（T05 ②）", async () => {
    getSakeDetail.mockResolvedValue(fullSake);

    const meta = await generateMetadata({
      params: Promise.resolve({ id: fullSake.id }),
    });

    expect(meta.title).toBe("獺祭 純米大吟醸 45");
  });

  it("存在しない銘柄では空のメタデータを返す（レイアウト既定に委ねる）", async () => {
    getSakeDetail.mockResolvedValue(null);

    const meta = await generateMetadata({
      params: Promise.resolve({ id: "missing" }),
    });

    expect(meta.title).toBeUndefined();
  });
});
