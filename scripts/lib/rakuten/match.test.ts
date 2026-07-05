import { describe, expect, it } from "vitest";

import {
  hasNgKeyword,
  normalizeForMatch,
  normalizeImageUrl,
  selectBestItem,
  type RakutenItemCandidate,
} from "./match";

/**
 * 画像照合ロジックのテスト（FR-09 受け入れ条件「誤マッチ抑止」）。
 * 誤った商品の画像を出すくらいなら出さない、の判定を固定する。
 */

const CDN = "https://thumbnail.image.rakuten.co.jp/@0_mall/shop/img";

function item(
  itemName: string,
  images: string[] = [`${CDN}/bottle.jpg?_ex=128x128`],
): RakutenItemCandidate {
  return {
    itemName,
    itemUrl: "https://item.rakuten.co.jp/shop/x/",
    mediumImageUrls: images,
  };
}

describe("normalizeForMatch", () => {
  it("全角英数・大文字・空白の差を無視できる形に正規化する", () => {
    expect(normalizeForMatch("獺祭 純米大吟醸４５")).toBe("獺祭純米大吟醸45");
    expect(normalizeForMatch("DASSAI 45")).toBe("dassai45");
  });
});

describe("hasNgKeyword", () => {
  it("セット・飲み比べ等の複合商品を検出する", () => {
    expect(hasNgKeyword("獺祭 飲み比べ 3本組")).toBe(true);
    expect(hasNgKeyword("日本酒 ギフトセット")).toBe(true);
    expect(hasNgKeyword("獺祭 純米大吟醸45 720ml")).toBe(false);
  });
});

describe("normalizeImageUrl", () => {
  it("楽天 CDN の URL をサイズ 400x400 に正規化する", () => {
    expect(normalizeImageUrl(`${CDN}/a.jpg?_ex=128x128`)).toBe(
      `${CDN}/a.jpg?_ex=400x400`,
    );
    // クエリなしでも _ex を付ける
    expect(normalizeImageUrl(`${CDN}/a.jpg`)).toBe(`${CDN}/a.jpg?_ex=400x400`);
  });

  it("楽天 CDN 以外・https 以外は採用しない", () => {
    expect(normalizeImageUrl("https://example.com/a.jpg")).toBeNull();
    expect(
      normalizeImageUrl(
        "http://thumbnail.image.rakuten.co.jp/@0_mall/shop/a.jpg",
      ),
    ).toBeNull();
    expect(normalizeImageUrl("not-a-url")).toBeNull();
  });
});

describe("selectBestItem", () => {
  const sake = { name: "獺祭 純米大吟醸45", breweryName: "旭酒造" };

  it("銘柄名を含まない商品は採用しない", () => {
    expect(selectBestItem(sake, [item("八海山 純米吟醸 720ml")])).toBeNull();
  });

  it("NG ワード（セット等）を含む商品は銘柄名が一致しても採用しない", () => {
    expect(
      selectBestItem(sake, [item("獺祭 純米大吟醸45 飲み比べセット")]),
    ).toBeNull();
  });

  it("楽天 CDN の画像を持たない商品は採用しない", () => {
    expect(
      selectBestItem(sake, [
        item("獺祭 純米大吟醸45 720ml", ["https://example.com/a.jpg"]),
      ]),
    ).toBeNull();
  });

  it("蔵元名を含む商品を優先する", () => {
    const result = selectBestItem(sake, [
      item("獺祭 純米大吟醸45 720ml 山口県"),
      item("獺祭 純米大吟醸45 720ml 旭酒造"),
    ]);
    expect(result?.itemName).toBe("獺祭 純米大吟醸45 720ml 旭酒造");
  });

  it("同条件なら商品名が短い（余計な語が少ない）方を選ぶ", () => {
    const result = selectBestItem(sake, [
      item("獺祭 純米大吟醸45 720ml 贈答 お歳暮 御祝 内祝 プレゼントに最適"),
      item("獺祭 純米大吟醸45 720ml"),
    ]);
    expect(result?.itemName).toBe("獺祭 純米大吟醸45 720ml");
  });

  it("採用した商品の画像 URL は 400x400 へ正規化されている", () => {
    const result = selectBestItem(sake, [item("獺祭 純米大吟醸45 720ml")]);
    expect(result?.imageUrl).toBe(`${CDN}/bottle.jpg?_ex=400x400`);
  });

  it("表記ゆれ（全角・空白差）でも銘柄名の包含を判定できる", () => {
    const result = selectBestItem(
      { name: "獺祭 純米大吟醸４５", breweryName: "旭酒造" },
      [item("獺祭純米大吟醸45 720ml")],
    );
    expect(result).not.toBeNull();
  });
});
