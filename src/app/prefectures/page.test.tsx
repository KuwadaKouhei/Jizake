// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PREFECTURES } from "@/lib/constants/prefectures";

import PrefecturesIndexPage from "./page";

function renderPage() {
  const markup = renderToStaticMarkup(<PrefecturesIndexPage />);
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("PrefecturesIndexPage", () => {
  it("47 都道府県それぞれへのリンクを表示する（FR-07 選択 UI）", () => {
    const doc = renderPage();

    for (const prefecture of PREFECTURES) {
      const link = doc.querySelector(
        `a[href="/prefectures/${prefecture.code}"]`,
      );
      expect(link, `link for ${prefecture.name}`).not.toBeNull();
      expect(link?.textContent).toContain(prefecture.name);
    }
  });

  it("地方の見出しを表示する", () => {
    const doc = renderPage();
    const text = doc.body.textContent ?? "";

    expect(text).toContain("北海道・東北");
    expect(text).toContain("関東");
    expect(text).toContain("九州・沖縄");
  });
});
