// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PREFECTURES } from "@/lib/constants/prefectures";

import PrefecturesIndexPage from "./page";

function renderPage() {
  const markup = renderToStaticMarkup(<PrefecturesIndexPage />);
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("PrefecturesIndexPage（日本地図の県選択 UI・T19）", () => {
  it("47 都道府県それぞれへのリンク（SVG 地図）を表示する（FR-07 選択 UI）", () => {
    const doc = renderPage();

    for (const prefecture of PREFECTURES) {
      const link = doc.querySelector(
        `a[href="/prefectures/${prefecture.code}"]`,
      );
      expect(link, `link for ${prefecture.name}`).not.toBeNull();
      // アクセシブルネーム（aria-label）と <title>（ツールチップ）の両方で県名を持つ
      expect(link?.getAttribute("aria-label")).toBe(prefecture.name);
      expect(link?.textContent).toContain(prefecture.name);
    }
  });

  it("リンクは 47 個ちょうど（重複導線を作らない。E2E の前提）", () => {
    const doc = renderPage();
    expect(doc.querySelectorAll('a[href^="/prefectures/"]')).toHaveLength(47);
  });

  it("各県リンクは描画パス（県の形）を持つ", () => {
    const doc = renderPage();
    const tokyo = doc.querySelector('a[href="/prefectures/13"]');
    expect(tokyo?.querySelectorAll("path").length).toBeGreaterThan(0);
  });
});
