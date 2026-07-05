// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/lib/auth/server";

const { getCurrentUser } = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
}));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/actions", () => ({
  signIn: async () => ({ error: null }),
  signInWithGoogle: async () => {},
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

import LoginPage from "./page";

async function render(next?: string): Promise<string> {
  const element = await LoginPage({
    searchParams: Promise.resolve(next ? { next } : {}),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => getCurrentUser.mockReset());

describe("LoginPage", () => {
  it("未ログインならログインフォームを表示する", async () => {
    getCurrentUser.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
  });

  it("Google ログインボタンを表示する（T24）", async () => {
    getCurrentUser.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain("Google でログイン");
  });

  it("error=oauth のとき OAuth エラー文言を表示する（T24）", async () => {
    getCurrentUser.mockResolvedValue(null);
    const element = await LoginPage({
      searchParams: Promise.resolve({ error: "oauth" }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Google ログインに失敗しました");
  });

  it("ログイン済みなら遷移先（既定 /）へリダイレクトする", async () => {
    getCurrentUser.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
    });
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("ログイン済みで安全な next があればそこへリダイレクトする", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", email: null });
    await expect(render("/history")).rejects.toThrow("NEXT_REDIRECT:/history");
  });

  it("危険な next（絶対 URL）はフォームの hidden に載せない", async () => {
    getCurrentUser.mockResolvedValue(null);
    const html = await render("https://evil.example");
    expect(html).not.toContain("evil.example");
  });

  it("安全な next を新規登録リンクにも引き継ぐ", async () => {
    getCurrentUser.mockResolvedValue(null);
    const html = await render("/history");
    expect(html).toContain("/signup?next=%2Fhistory");
  });
});
