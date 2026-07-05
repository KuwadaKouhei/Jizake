// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PrefectureSakesPage as PrefectureSakesResult,
  SakeSummary,
} from "@/lib/db/queries/sakes";

// 一覧取得クエリは PGlite 統合テスト（sakes.test.ts）で担保済み。
// ここでは DB 接続を避け、表示ロジック・空状態・ページャ・分岐だけを検証する。
const { getSakesByPrefecture } = vi.hoisted(() => ({
  getSakesByPrefecture:
    vi.fn<(code: string, page?: number) => Promise<PrefectureSakesResult>>(),
}));
vi.mock("@/lib/db/queries/sakes", () => ({
  getSakesByPrefecture,
  PAGE_SIZE: 24,
}));

const notFoundError = new Error("NEXT_NOT_FOUND");
// redirect は投げて中断する（Next.js の実挙動を再現）。呼び出し先 URL をメッセージに載せる。
class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw notFoundError;
  },
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

import PrefectureSakesPage, { generateMetadata } from "./page";

const sake: SakeSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "獺祭 純米大吟醸 45",
  breweryName: "旭酒造",
  prefectureCode: "35",
  imageUrl: null,
  tags: [{ id: "t1", name: "純米大吟醸", category: "type", source: "manual" }],
};

function result(
  overrides: Partial<PrefectureSakesResult> &
    Pick<PrefectureSakesResult, "sakes" | "total">,
): PrefectureSakesResult {
  return { page: 1, pageSize: 24, ...overrides };
}

async function renderPage(code: string, page?: string) {
  const element = await PrefectureSakesPage({
    params: Promise.resolve({ code }),
    searchParams: Promise.resolve(page === undefined ? {} : { page }),
  });
  const markup = renderToStaticMarkup(element);
  return new DOMParser().parseFromString(markup, "text/html");
}

beforeEach(() => {
  getSakesByPrefecture.mockReset();
});

describe("PrefectureSakesPage", () => {
  it("県名見出しと銘柄カード（詳細リンク付き）を表示する（FR-07）", async () => {
    getSakesByPrefecture.mockResolvedValue(result({ sakes: [sake], total: 1 }));

    const doc = await renderPage("35"); // 山口
    const text = doc.body.textContent ?? "";

    expect(doc.querySelector("h1")?.textContent).toContain("山口県の地酒");
    expect(text).toContain("獺祭 純米大吟醸 45");
    expect(text).toContain("旭酒造");
    expect(text).toContain("1件の銘柄");
    // カードから詳細ページへ遷移できる
    expect(
      doc.querySelector('a[href="/sake/11111111-1111-4111-8111-111111111111"]'),
    ).not.toBeNull();
  });

  it("1 ページに収まる県ではページャを出さない", async () => {
    getSakesByPrefecture.mockResolvedValue(result({ sakes: [sake], total: 1 }));

    const doc = await renderPage("35");
    expect(doc.querySelector('nav[aria-label="ページ送り"]')).toBeNull();
  });

  it("複数ページある県ではページャを出し、次へリンクと総ページ数を表示する", async () => {
    // 30 件・1 ページ目（24 件表示）→ 総 2 ページ
    getSakesByPrefecture.mockResolvedValue(
      result({ sakes: [sake], total: 30, page: 1 }),
    );

    const doc = await renderPage("28", "1");
    const pager = doc.querySelector('nav[aria-label="ページ送り"]');
    expect(pager).not.toBeNull();
    expect(pager?.textContent).toContain("1 / 2 ページ");
    // 「N件」は総件数（ページ内件数でない）
    expect(doc.body.textContent).toContain("30件の銘柄");
    // 次へは page=2 へのリンク。前へは 1 ページ目なのでリンクではない
    expect(
      pager?.querySelector('a[href="/prefectures/28?page=2"]'),
    ).not.toBeNull();
    expect(pager?.querySelector('a[href="/prefectures/28?page=0"]')).toBeNull();
  });

  it("最終ページでは前へリンクを出し次へリンクは出さない", async () => {
    getSakesByPrefecture.mockResolvedValue(
      result({ sakes: [sake], total: 30, page: 2 }),
    );

    const doc = await renderPage("28", "2");
    const pager = doc.querySelector('nav[aria-label="ページ送り"]');
    expect(
      pager?.querySelector('a[href="/prefectures/28?page=1"]'),
    ).not.toBeNull();
    expect(pager?.querySelector('a[href="/prefectures/28?page=3"]')).toBeNull();
  });

  it("不正な page（0・負・非数）は 1 ページ目として扱う", async () => {
    getSakesByPrefecture.mockResolvedValue(result({ sakes: [sake], total: 1 }));

    await renderPage("35", "0");
    expect(getSakesByPrefecture).toHaveBeenLastCalledWith("35", 1);

    await renderPage("35", "abc");
    expect(getSakesByPrefecture).toHaveBeenLastCalledWith("35", 1);
  });

  it("総ページ数を超える page は最終ページへ redirect する", async () => {
    // total=30（2 ページ）に対し page=99 を要求
    getSakesByPrefecture.mockResolvedValue(
      result({ sakes: [], total: 30, page: 99 }),
    );

    await expect(renderPage("28", "99")).rejects.toMatchObject({
      url: "/prefectures/28?page=2",
    });
  });

  it("0 件のときは空状態メッセージを表示する（redirect しない）", async () => {
    getSakesByPrefecture.mockResolvedValue(result({ sakes: [], total: 0 }));

    const doc = await renderPage("47"); // 沖縄
    const text = doc.body.textContent ?? "";

    expect(text).toContain("沖縄県");
    expect(text).toContain("まだ登録されていません");
    expect(doc.querySelector('a[href^="/sake/"]')).toBeNull();
    expect(doc.querySelector('nav[aria-label="ページ送り"]')).toBeNull();
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

describe("generateStaticParams", () => {
  it("47 都道府県コードすべてをプリレンダ対象に返す（性能 S-2）", async () => {
    const { generateStaticParams } = await import("./page");
    const params = generateStaticParams();
    expect(params).toHaveLength(47);
    expect(params).toContainEqual({ code: "01" });
    expect(params).toContainEqual({ code: "47" });
  });
});
