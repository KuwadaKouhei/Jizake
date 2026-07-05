// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SakeSummary, SearchSakesPage } from "@/lib/db/queries/sakes";
import type { TagOption } from "@/lib/db/queries/tags";

// 検索クエリ・タグ候補クエリは PGlite 統合テスト（sakes.test.ts / tags.test.ts）で
// 担保済み。ここでは DB 接続を避け、フォーム・結果表示・空状態・ページャ・
// 不正 page の丸め・範囲外 redirect だけを検証する。
const { getSearchSakes, getTasteTagOptions } = vi.hoisted(() => ({
  getSearchSakes: vi.fn<(query: unknown) => Promise<SearchSakesPage>>(),
  getTasteTagOptions: vi.fn<() => Promise<TagOption[]>>(),
}));
vi.mock("@/lib/db/queries/sakes", () => ({ getSearchSakes, PAGE_SIZE: 24 }));
vi.mock("@/lib/db/queries/tags", () => ({ getTasteTagOptions }));

// 検索記録トリガ（Client Component）は Server Action → DB へ至るチェーンを持つため、
// ページ表示検証ではモックで無効化する（Vitest が "use server" 境界を尊重せず
// client.ts のサーバ専用ガードに触れるのを避ける。記録は record-search.test.ts で検証）。
vi.mock("./_components/record-search-trigger", () => ({
  RecordSearchTrigger: () => null,
}));

class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

import SearchPage from "./page";

const sake: SakeSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "獺祭 純米大吟醸 45",
  breweryName: "旭酒造",
  prefectureCode: "35",
  imageUrl: null,
  tags: [{ id: "t1", name: "純米大吟醸", category: "type", source: "manual" }],
};

const tasteTags: TagOption[] = [
  { id: "tg1", name: "辛口", category: "taste" },
  { id: "tg2", name: "フルーティ", category: "taste" },
];

function page(
  overrides: Partial<SearchSakesPage> &
    Pick<SearchSakesPage, "sakes" | "total">,
): SearchSakesPage {
  return { page: 1, pageSize: 24, ...overrides };
}

async function renderSearch(raw: Record<string, string | string[]>) {
  getTasteTagOptions.mockResolvedValue(tasteTags);
  const element = await SearchPage({ searchParams: Promise.resolve(raw) });
  return new DOMParser().parseFromString(
    renderToStaticMarkup(element),
    "text/html",
  );
}

describe("SearchPage", () => {
  it("検索フォーム（名前・都道府県・味タグ）を表示する", async () => {
    getSearchSakes.mockResolvedValue(page({ sakes: [], total: 0 }));
    const doc = await renderSearch({});

    expect(doc.querySelector('form[method="get"]')).not.toBeNull();
    expect(doc.querySelector('input[name="q"]')).not.toBeNull();
    expect(doc.querySelector('select[name="prefecture"]')).not.toBeNull();
    // 味タグ候補がチェックボックスで出る
    const tagBoxes = doc.querySelectorAll(
      'input[type="checkbox"][name="tags"]',
    );
    expect(tagBoxes.length).toBe(2);
  });

  it("結果があれば銘柄カードを詳細リンク付きで表示する（FR-06）", async () => {
    getSearchSakes.mockResolvedValue(page({ sakes: [sake], total: 1 }));
    const doc = await renderSearch({ q: "獺祭" });

    expect(doc.body.textContent).toContain("1件の銘柄が見つかりました");
    expect(
      doc.querySelector('a[href="/sake/11111111-1111-4111-8111-111111111111"]'),
    ).not.toBeNull();
  });

  it("0 件なら空状態メッセージを出す", async () => {
    getSearchSakes.mockResolvedValue(page({ sakes: [], total: 0 }));
    const doc = await renderSearch({ q: "存在しない銘柄" });

    expect(doc.body.textContent).toContain("見つかりませんでした");
  });

  it("複数ページある場合はページャを出し、条件を保ったリンクにする", async () => {
    getSearchSakes.mockResolvedValue(
      page({ sakes: [sake], total: 50, page: 1 }),
    );
    const doc = await renderSearch({ q: "獺祭", tags: "辛口" });

    const next = doc.querySelector('a[rel="next"]');
    expect(next).not.toBeNull();
    const href = next?.getAttribute("href") ?? "";
    expect(href).toContain("page=2");
    expect(href).toContain("q=");
    expect(href).toContain("tags=");
  });

  it("1 ページに収まる場合はページャを出さない", async () => {
    getSearchSakes.mockResolvedValue(page({ sakes: [sake], total: 1 }));
    const doc = await renderSearch({});

    expect(doc.querySelector('a[rel="next"]')).toBeNull();
    expect(doc.querySelector('a[rel="prev"]')).toBeNull();
  });

  it("総ページ数を超える page は最終ページへ redirect（条件を保持）", async () => {
    // total 50 / 24 件per頁 = 3 ページ。page=99 は最終ページ 3 へ丸める。
    getSearchSakes.mockResolvedValue(page({ sakes: [], total: 50, page: 99 }));
    await expect(renderSearch({ q: "獺祭", page: "99" })).rejects.toThrow(
      /NEXT_REDIRECT:\/search\?q=.*page=3/,
    );
  });

  it("検索クエリには正規化済みの条件が渡る（不正 page は 1 に丸め）", async () => {
    getSearchSakes.mockResolvedValue(page({ sakes: [], total: 0 }));
    await renderSearch({ q: "  獺祭  ", prefecture: "35", page: "abc" });

    expect(getSearchSakes).toHaveBeenCalledWith({
      q: "獺祭",
      prefectureCode: "35",
      tagNames: [],
      page: 1,
    });
  });
});
