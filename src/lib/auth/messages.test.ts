import { describe, expect, it } from "vitest";

import {
  confirmationSentMessage,
  signInErrorMessage,
  signUpErrorMessage,
} from "./messages";

describe("signInErrorMessage", () => {
  it("メール不存在とパスワード誤りを区別しない汎用文言を返す", () => {
    expect(signInErrorMessage()).toBe(
      "メールアドレスまたはパスワードが正しくありません。",
    );
  });
});

describe("signUpErrorMessage", () => {
  it("既存メール（Supabase 文言）を専用文言に正規化する", () => {
    expect(signUpErrorMessage("User already registered")).toBe(
      "このメールアドレスは既に登録されています。",
    );
  });

  it("その他のエラーは実装詳細を出さない汎用文言にする", () => {
    expect(signUpErrorMessage("weird internal db error")).toBe(
      "登録に失敗しました。入力内容をご確認ください。",
    );
  });
});

describe("confirmationSentMessage", () => {
  it("メール確認待ちの案内文言を返す", () => {
    expect(confirmationSentMessage()).toContain("確認メール");
  });
});
