// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/lib/auth/server";
import type { SakeSummary } from "@/lib/db/queries/sakes";

import type { SearchHistoryPage, ViewHistoryPage } from "./_lib/queries";

const { getCurrentUser } = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
}));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser }));

const { getViewHistoryPage, getSearchHistoryPage } = vi.hoisted(() => ({
  getViewHistoryPage: vi.fn<() => Promise<ViewHistoryPage>>(),
  getSearchHistoryPage: vi.fn<() => Promise<SearchHistoryPage>>(),
}));
vi.mock("./_lib/queries", () => ({ getViewHistoryPage, getSearchHistoryPage }));

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

import HistoryPage from "./page";

function sake(id: string, name: string): SakeSummary {
  return { id, name, breweryName: "旭酒造", prefectureCode: "35", tags: [] };
}

const emptyView: ViewHistoryPage = {
  entries: [],
  total: 0,
  page: 1,
  pageSize: 24,
};
const emptySearch: SearchHistoryPage = {
  entries: [],
  total: 0,
  page: 1,
  pageSize: 24,
};

async function render(): Promise<string> {
  return renderToStaticMarkup(await HistoryPage());
}

beforeEach(() => {
  getCurrentUser.mockReset();
  getViewHistoryPage.mockReset();
  getSearchHistoryPage.mockReset();
  getViewHistoryPage.mockResolvedValue(emptyView);
  getSearchHistoryPage.mockResolvedValue(emptySearch);
});

describe("HistoryPage（保護ルート）", () => {
  it("未ログインなら /login?next=/history へリダイレクトする", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(render()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fhistory",
    );
  });

  it("履歴が無ければ空状態メッセージを表示する", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", email: "u@example.com" });
    const html = await render();
    expect(html).toContain("まだ閲覧した日本酒はありません");
    expect(html).toContain("まだ検索履歴はありません");
  });

  it("閲覧履歴を SakeCard（詳細リンク）と閲覧日時つきで表示する", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", email: null });
    getViewHistoryPage.mockResolvedValue({
      ...emptyView,
      total: 1,
      entries: [
        {
          id: "v1",
          sake: sake("d1111111-1111-4111-8111-111111111111", "獺祭"),
          viewedAt: new Date("2026-07-04T03:00:00Z"),
        },
      ],
    });
    const html = await render();
    expect(html).toContain("獺祭");
    // 詳細ページへのリンク（SakeCard）。
    expect(html).toContain("/sake/d1111111-1111-4111-8111-111111111111");
    // JST 表示（03:00 UTC → 12:00 JST）。
    expect(html).toContain("2026/07/04 12:00");
  });

  it("検索履歴を条件バッジと再検索リンクで表示する", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", email: null });
    getSearchHistoryPage.mockResolvedValue({
      ...emptySearch,
      total: 1,
      entries: [
        {
          id: "s1",
          query: "獺祭",
          filters: { prefectureCode: "35", tagNames: ["辛口"] },
          searchedAt: new Date("2026-07-04T00:00:00Z"),
        },
      ],
    });
    const html = await render();
    expect(html).toContain("名前: 獺祭");
    expect(html).toContain("山口県");
    expect(html).toContain("辛口");
    // 再検索リンク（/search? に条件が載る）。
    expect(html).toContain("/search?");
    expect(html).toContain("この条件で再検索");
  });
});
