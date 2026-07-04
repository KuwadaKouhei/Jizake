// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/lib/auth/server";

// getCurrentUser をモックしてログイン状態を切り替える。
// signOut は Server Action のため呼び出しはせず、フォーム描画のみ確認する。
const { getCurrentUser } = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
}));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/actions", () => ({
  signOut: async () => {},
}));

import { SiteHeader } from "@/components/site-header";

async function renderHeader(): Promise<string> {
  return renderToStaticMarkup(await SiteHeader());
}

beforeEach(() => {
  getCurrentUser.mockReset();
});

describe("SiteHeader — 共通導線", () => {
  it("サイト名 Jizake がホームへのリンクとして表示される", async () => {
    getCurrentUser.mockResolvedValue(null);
    const html = await renderHeader();
    expect(html).toContain(">Jizake</a>");
    expect(html).toContain('href="/"');
  });

  it("実装済み機能（ホーム・検索・地酒を探す）への導線がある", async () => {
    getCurrentUser.mockResolvedValue(null);
    const html = await renderHeader();
    expect(html).toContain(">ホーム</a>");
    expect(html).toContain('href="/search"');
    expect(html).toContain('href="/prefectures"');
  });
});

describe("SiteHeader — 未ログイン", () => {
  beforeEach(() => getCurrentUser.mockResolvedValue(null));

  it("ログイン・新規登録への導線を出す", async () => {
    const html = await renderHeader();
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/signup"');
  });

  it("履歴リンク・ログアウトボタンは出さない", async () => {
    const html = await renderHeader();
    expect(html).not.toContain('href="/history"');
    expect(html).not.toContain("ログアウト");
  });
});

describe("SiteHeader — ログイン済み", () => {
  beforeEach(() =>
    getCurrentUser.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "user@example.com",
    }),
  );

  it("履歴リンクとログアウト（フォーム）を出す", async () => {
    const html = await renderHeader();
    expect(html).toContain('href="/history"');
    expect(html).toContain("<form");
    expect(html).toContain("ログアウト");
  });

  it("ログイン・新規登録への導線は出さない", async () => {
    const html = await renderHeader();
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/signup"');
  });
});
