// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SakeDetail } from "@/lib/db/queries/sakes";

import { ExternalLinks } from "./external-links";

/**
 * 外部リンク表示の描画テスト（FR-03）。
 * - 別タブ（target="_blank"）＋ rel="noopener noreferrer" を検証する。
 * - 欠損時の Amazon 検索フォールバックが href に反映されることを確認する。
 */

const base: SakeDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "獺祭 純米大吟醸 45",
  breweryName: "旭酒造",
  prefectureCode: "35",
  tags: [],
  reading: null,
  description: null,
  officialUrl: null,
  amazonUrl: null,
  rakutenUrl: null,
  priceRange: null,
  flavor: null,
};

function renderLinks(sake: SakeDetail) {
  const markup = renderToStaticMarkup(<ExternalLinks sake={sake} />);
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("ExternalLinks", () => {
  it("外部リンクは別タブ＋ rel=noopener noreferrer で開く（FR-03）", () => {
    const doc = renderLinks({
      ...base,
      officialUrl: "https://example.com/dassai",
    });

    const anchors = [...doc.querySelectorAll("a")];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("amazon_url 欠損時は銘柄名から Amazon 検索リンクを生成する", () => {
    const doc = renderLinks(base);

    const amazon = doc.querySelector(
      'a[href^="https://www.amazon.co.jp/s?k="]',
    );
    expect(amazon).not.toBeNull();
  });

  it("公式・楽天が欠損すれば非表示（Amazon のみ表示）", () => {
    const doc = renderLinks(base);

    // official / rakuten の要素は無く、Amazon 検索リンク 1 本のみ
    expect(doc.querySelectorAll("a")).toHaveLength(1);
  });
});
