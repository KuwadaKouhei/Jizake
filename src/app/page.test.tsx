// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/lib/auth/server";
import type { RecommendedSake } from "@/lib/recommend";

const { getCurrentUser } = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
}));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser }));

const { recommend } = vi.hoisted(() => ({
  recommend: vi.fn<() => Promise<RecommendedSake[]>>(),
}));
vi.mock("@/lib/recommend", () => ({ recommend }));

import Home from "./page";

function recommended(
  id: string,
  name: string,
  reason: RecommendedSake["reason"],
): RecommendedSake {
  return {
    sake: { id, name, breweryName: "旭酒造", prefectureCode: "35", tags: [] },
    reason,
  };
}

async function render(): Promise<Document> {
  const markup = renderToStaticMarkup(await Home());
  return new DOMParser().parseFromString(markup, "text/html");
}

beforeEach(() => {
  getCurrentUser.mockReset();
  recommend.mockReset();
  recommend.mockResolvedValue([]);
});

describe("Home（ホームの推薦表示）", () => {
  it("未ログインは人気ランキング見出し＋ログイン誘導を出す", async () => {
    getCurrentUser.mockResolvedValue(null);
    recommend.mockResolvedValue([
      recommended("d1111111-1111-4111-8111-111111111111", "人気酒", {
        kind: "popular",
      }),
    ]);
    const doc = await render();

    expect(doc.body.textContent).toContain("人気の日本酒");
    expect(doc.body.textContent).not.toContain("あなたへのおすすめ");
    // ログイン誘導。
    expect(doc.querySelector('a[href="/login"]')).not.toBeNull();
    expect(doc.querySelector('a[href="/signup"]')).not.toBeNull();
    // reason 表示。
    expect(doc.body.textContent).toContain("人気の銘柄");
    // 未ログインは userId=null で呼ばれる（limit は罫線グリッド 4 列×2 段）。
    expect(recommend).toHaveBeenCalledWith({ userId: null, limit: 8 });
  });

  it("ログインユーザーには『あなたへのおすすめ』見出しと履歴ベース理由を出す", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", email: "u@example.com" });
    recommend.mockResolvedValue([
      recommended("d2222222-2222-4222-8222-222222222222", "獺祭 磨き", {
        kind: "history",
        signals: [{ type: "tag", label: "辛口" }],
      }),
    ]);
    const doc = await render();

    expect(doc.body.textContent).toContain("あなたへのおすすめ");
    expect(doc.body.textContent).not.toContain("人気の日本酒");
    // ログイン誘導は出さない。
    expect(doc.querySelector('a[href="/login"]')).toBeNull();
    // 銘柄カード（詳細リンク）＋推薦理由。
    expect(
      doc.querySelector('a[href="/sake/d2222222-2222-4222-8222-222222222222"]'),
    ).not.toBeNull();
    expect(doc.body.textContent).toContain("よく見ている「辛口」から");
    // ログインは userId 付きで呼ばれる（limit は罫線グリッド 4 列×2 段）。
    expect(recommend).toHaveBeenCalledWith({ userId: "u1", limit: 8 });
  });

  it("ログイン済みでも中身が全て人気（フォールバック）なら見出しを『人気の日本酒』に倒す", async () => {
    // 履歴しきい値未満のログインユーザー: reason が全て popular。透明性のため見出しを
    // 「あなたへのおすすめ」と偽らない（REVIEW T10 PHIL S-2）。ログイン誘導は出さない。
    getCurrentUser.mockResolvedValue({ id: "u1", email: null });
    recommend.mockResolvedValue([
      recommended("d3333333-3333-4333-8333-333333333333", "人気酒", {
        kind: "popular",
      }),
    ]);
    const doc = await render();

    expect(doc.body.textContent).toContain("人気の日本酒");
    expect(doc.body.textContent).not.toContain("あなたへのおすすめ");
    // ログイン済みなのでログイン誘導は出さない。
    expect(doc.querySelector('a[href="/login"]')).toBeNull();
  });

  it("推薦が空なら空状態と探索導線を出す", async () => {
    getCurrentUser.mockResolvedValue(null);
    recommend.mockResolvedValue([]);
    const doc = await render();

    expect(doc.body.textContent).toContain(
      "まだおすすめできる日本酒がありません",
    );
    expect(doc.querySelector('a[href="/prefectures"]')).not.toBeNull();
  });
});
