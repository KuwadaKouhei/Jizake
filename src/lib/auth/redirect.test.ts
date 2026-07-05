import { describe, expect, it } from "vitest";

import {
  buildLoginRedirect,
  isProtectedPath,
  resolveAfterLogin,
  sanitizeRedirectPath,
} from "./redirect";

describe("isProtectedPath", () => {
  it("/history は保護対象", () => {
    expect(isProtectedPath("/history")).toBe(true);
  });

  it("/history 配下も保護対象", () => {
    expect(isProtectedPath("/history/detail")).toBe(true);
  });

  it("/favorites も保護対象（T25）", () => {
    expect(isProtectedPath("/favorites")).toBe(true);
    expect(isProtectedPath("/favorites/x")).toBe(true);
  });

  it("接頭辞が一致するだけの別ルートは保護しない", () => {
    expect(isProtectedPath("/historyx")).toBe(false);
    expect(isProtectedPath("/history-archive")).toBe(false);
  });

  it("未保護ルートは false", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/search")).toBe(false);
    expect(isProtectedPath("/sake/abc")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
  });

  it("大文字小文字を正規化して保護する（バイパス防止）", () => {
    expect(isProtectedPath("/History")).toBe(true);
    expect(isProtectedPath("/HISTORY")).toBe(true);
    expect(isProtectedPath("/History/detail")).toBe(true);
    // 別ルートは大文字でも保護しない
    expect(isProtectedPath("/Historyx")).toBe(false);
  });
});

describe("sanitizeRedirectPath", () => {
  it("アプリ内の相対パスはそのまま許可する", () => {
    expect(sanitizeRedirectPath("/history")).toBe("/history");
    expect(sanitizeRedirectPath("/search?q=獺祭")).toBe("/search?q=獺祭");
  });

  it("空・null・undefined は null", () => {
    expect(sanitizeRedirectPath("")).toBeNull();
    expect(sanitizeRedirectPath(null)).toBeNull();
    expect(sanitizeRedirectPath(undefined)).toBeNull();
  });

  it("絶対 URL（別サイト）を弾く", () => {
    expect(sanitizeRedirectPath("https://evil.example/steal")).toBeNull();
    expect(sanitizeRedirectPath("http://evil.example")).toBeNull();
  });

  it("プロトコル相対 URL（//host）を弾く", () => {
    expect(sanitizeRedirectPath("//evil.example")).toBeNull();
  });

  it("バックスラッシュによるスキーム回避を弾く", () => {
    expect(sanitizeRedirectPath("/\\evil.example")).toBeNull();
    expect(sanitizeRedirectPath("/foo\\bar")).toBeNull();
  });

  it("スラッシュ始まりでない相対参照を弾く", () => {
    expect(sanitizeRedirectPath("history")).toBeNull();
    expect(sanitizeRedirectPath("javascript:alert(1)")).toBeNull();
  });

  it("制御文字を含むものを弾く", () => {
    expect(sanitizeRedirectPath("/foo\nbar")).toBeNull();
    expect(sanitizeRedirectPath("/foo\tbar")).toBeNull();
  });
});

describe("resolveAfterLogin", () => {
  it("安全な next があればそこへ", () => {
    expect(resolveAfterLogin("/history")).toBe("/history");
  });

  it("危険な next は既定（/）へ落とす", () => {
    expect(resolveAfterLogin("https://evil.example")).toBe("/");
    expect(resolveAfterLogin(null)).toBe("/");
  });
});

describe("buildLoginRedirect", () => {
  it("元パスを next にエンコードして付与する", () => {
    expect(buildLoginRedirect("/history")).toBe("/login?next=%2Fhistory");
  });

  it("危険なパスは next を付けず /login にする", () => {
    expect(buildLoginRedirect("//evil.example")).toBe("/login");
  });
});
