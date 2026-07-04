// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AuthForm } from "@/components/auth-form";

afterEach(cleanup);

const noopAction = async () => ({ error: null });

describe("AuthForm", () => {
  it("メール・パスワード入力と送信ボタンを描画する", () => {
    render(
      <AuthForm
        action={noopAction}
        submitLabel="ログイン"
        passwordMinLength={6}
        altPrompt={{
          text: "未登録の方は",
          linkLabel: "新規登録",
          href: "/signup",
        }}
      />,
    );

    expect(
      document.querySelector('input[type="email"][name="email"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('input[type="password"][name="password"]'),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "ログイン" })).not.toBeNull();
  });

  it("next が渡されると hidden フィールドに載せる", () => {
    render(
      <AuthForm
        action={noopAction}
        submitLabel="ログイン"
        passwordMinLength={6}
        next="/history"
        altPrompt={{ text: "x", linkLabel: "y", href: "/signup" }}
      />,
    );

    const hidden = document.querySelector('input[type="hidden"][name="next"]');
    expect(hidden?.getAttribute("value")).toBe("/history");
  });

  it("next が無ければ hidden フィールドを出さない", () => {
    render(
      <AuthForm
        action={noopAction}
        submitLabel="ログイン"
        passwordMinLength={6}
        altPrompt={{ text: "x", linkLabel: "y", href: "/signup" }}
      />,
    );
    expect(
      document.querySelector('input[type="hidden"][name="next"]'),
    ).toBeNull();
  });

  it("反対画面への案内リンクを表示する", () => {
    render(
      <AuthForm
        action={noopAction}
        submitLabel="登録する"
        passwordMinLength={6}
        altPrompt={{
          text: "既にアカウントをお持ちの方は",
          linkLabel: "ログイン",
          href: "/login",
        }}
      />,
    );
    const link = screen.getByRole("link", { name: "ログイン" });
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("パスワード補足を渡すと表示する", () => {
    render(
      <AuthForm
        action={noopAction}
        submitLabel="登録する"
        passwordMinLength={6}
        passwordHint="6文字以上"
        altPrompt={{ text: "x", linkLabel: "y", href: "/login" }}
      />,
    );
    expect(screen.getByText("6文字以上")).not.toBeNull();
  });

  it("passwordAutoComplete と minLength を input に反映する（登録は new-password）", () => {
    render(
      <AuthForm
        action={noopAction}
        submitLabel="登録する"
        passwordAutoComplete="new-password"
        passwordMinLength={8}
        altPrompt={{ text: "x", linkLabel: "y", href: "/login" }}
      />,
    );
    const pw = document.querySelector('input[name="password"]');
    expect(pw?.getAttribute("autocomplete")).toBe("new-password");
    expect(pw?.getAttribute("minlength")).toBe("8");
  });
});
