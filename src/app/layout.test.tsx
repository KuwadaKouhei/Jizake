// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import RootLayout, { metadata } from "@/app/layout";

// next/font/google はビルド時プラグイン前提のため、テストでは固定値を返すモックに差し替える
// （TEST_PHILOSOPHY: 自作モジュールはモックしない。これは外部 FW 境界のモック）
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-sans", className: "" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono", className: "" }),
}));

// SiteHeader は async Server Component（認証状態を取得）になったため、
// RootLayout の SSR 出力を同期検証できるよう同期スタブに差し替える。
// ヘッダー本体（ログイン状態別表示）は site-header.test.tsx で検証する。
vi.mock("@/components/site-header", () => ({
  SiteHeader: () => <header>Jizake</header>,
}));

// RootLayout は <html> ごと返すため、DOM へのマウントではなく
// SSR 出力（静的マークアップ）を文書としてパースして検証する
function renderLayoutDocument() {
  const markup = renderToStaticMarkup(
    <RootLayout>
      <p>テスト用コンテンツ</p>
    </RootLayout>,
  );
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("RootLayout", () => {
  it('html 要素に lang="ja" が設定されている（日本語 UI の基盤）', () => {
    const doc = renderLayoutDocument();

    expect(doc.documentElement.getAttribute("lang")).toBe("ja");
  });

  it("全ページ共通ヘッダーにサイト名 Jizake が表示される", () => {
    const doc = renderLayoutDocument();

    expect(doc.querySelector("header")?.textContent).toContain("Jizake");
  });

  it("全ページ共通フッターにさけのわ帰属リンクが常設される", () => {
    const doc = renderLayoutDocument();

    const attribution = doc.querySelector(
      'footer a[href="https://sakenowa.com"]',
    );

    expect(attribution).not.toBeNull();
    expect(attribution?.textContent).toContain("さけのわデータ");
  });

  it("children が main 領域に描画される", () => {
    const doc = renderLayoutDocument();

    expect(doc.querySelector("main")?.textContent).toContain(
      "テスト用コンテンツ",
    );
  });
});

describe("metadata", () => {
  it("サイトタイトルが日本語のデフォルト＋テンプレートで定義されている", () => {
    expect(metadata.title).toMatchObject({
      default: "Jizake — 日本酒レコメンド",
      template: "%s | Jizake",
    });
  });
});
