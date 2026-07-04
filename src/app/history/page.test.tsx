// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/lib/auth/server";

const { getCurrentUser } = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
}));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser }));

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

async function render(): Promise<string> {
  return renderToStaticMarkup(await HistoryPage());
}

beforeEach(() => getCurrentUser.mockReset());

describe("HistoryPage（保護ルート）", () => {
  it("未ログインなら /login?next=/history へリダイレクトする", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(render()).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fhistory",
    );
  });

  it("ログイン済みならプレースホルダを表示する", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", email: "u@example.com" });
    const html = await render();
    expect(html).toContain("履歴");
    expect(html).toContain("検索する");
  });
});
