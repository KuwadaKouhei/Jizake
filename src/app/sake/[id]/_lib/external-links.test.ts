import { describe, expect, it } from "vitest";

import { buildAmazonSearchUrl, buildExternalLinks } from "./external-links";

/**
 * 外部リンク組み立て（純関数）のテスト（FR-03）。
 * - 欠損リンクは非表示（配列に含めない）。
 * - Amazon は欠損時に銘柄名から検索 URL を生成する。
 * - https 以外の URL は無効として弾く（防御的多重化）。
 */

const base = {
  name: "獺祭 純米大吟醸 45",
  officialUrl: null,
  amazonUrl: null,
  rakutenUrl: null,
};

describe("buildAmazonSearchUrl", () => {
  it("銘柄名を k パラメータにエンコードした Amazon 検索 URL を返す", () => {
    const url = buildAmazonSearchUrl("獺祭 45");
    expect(url.startsWith("https://www.amazon.co.jp/s?k=")).toBe(true);
    // URL としてパースでき、k に銘柄名が入っている
    const parsed = new URL(url);
    expect(parsed.searchParams.get("k")).toBe("獺祭 45");
  });
});

describe("buildExternalLinks", () => {
  it("全リンクが揃うと official・amazon・rakuten を返す", () => {
    const links = buildExternalLinks({
      name: "獺祭",
      officialUrl: "https://example.com/dassai",
      amazonUrl: "https://www.amazon.co.jp/dp/TEST",
      rakutenUrl: "https://item.rakuten.co.jp/test",
    });

    expect(links.map((l) => l.kind)).toEqual(["official", "amazon", "rakuten"]);
    expect(links.every((l) => l.generated === false)).toBe(true);
    expect(links.find((l) => l.kind === "amazon")?.href).toBe(
      "https://www.amazon.co.jp/dp/TEST",
    );
  });

  it("official・rakuten が欠損なら非表示にする（配列に含めない）", () => {
    const links = buildExternalLinks(base);
    expect(links.map((l) => l.kind)).toEqual(["amazon"]);
  });

  it("amazon_url が欠損なら銘柄名から検索 URL を生成する（generated=true）", () => {
    const links = buildExternalLinks(base);
    const amazon = links.find((l) => l.kind === "amazon");

    expect(amazon?.generated).toBe(true);
    expect(amazon?.href).toBe(buildAmazonSearchUrl(base.name));
  });

  it("https 以外の URL は無効として弾く（防御的多重化）", () => {
    const links = buildExternalLinks({
      name: "検証酒",
      officialUrl: "javascript:alert(1)",
      amazonUrl: "http://www.amazon.co.jp/dp/TEST",
      rakutenUrl: "data:text/html,<script>alert(1)</script>",
    });

    // official と rakuten は無効化されて非表示、amazon は http のため
    // 無効化 → 検索 URL 生成にフォールバックする
    expect(links.map((l) => l.kind)).toEqual(["amazon"]);
    expect(links[0]?.generated).toBe(true);
    expect(links[0]?.href.startsWith("https://")).toBe(true);
  });
});
