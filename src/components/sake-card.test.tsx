// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SakeCard } from "@/components/sake-card";
import type { SakeSummary } from "@/lib/db/queries/sakes";

/**
 * 銘柄カードの表示テスト。
 * SSR 出力を DOM としてパースし、名称・蔵元・都道府県・タグ・詳細リンクを検証する
 * （layout.test.tsx と同型の描画方式）。
 */

const baseSake: SakeSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "獺祭 純米大吟醸 45",
  breweryName: "旭酒造",
  prefectureCode: "35",
  imageUrl: null,
  tags: [
    { id: "t1", name: "純米大吟醸", category: "type", source: "manual" },
    { id: "t2", name: "華やか", category: "taste", source: "sakenowa" },
  ],
};

function renderCard(sake: SakeSummary) {
  const markup = renderToStaticMarkup(<SakeCard sake={sake} />);
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("SakeCard", () => {
  it("銘柄名・蔵元・都道府県名を表示する", () => {
    const doc = renderCard(baseSake);
    const text = doc.body.textContent ?? "";

    expect(text).toContain("獺祭 純米大吟醸 45");
    expect(text).toContain("旭酒造");
    expect(text).toContain("山口県");
  });

  it("詳細ページ（/sake/[id]）への Link を持つ（FR-06 導線）", () => {
    const doc = renderCard(baseSake);

    const link = doc.querySelector(
      'a[href="/sake/11111111-1111-4111-8111-111111111111"]',
    );
    expect(link).not.toBeNull();
  });

  it("主要タグを表示する", () => {
    const doc = renderCard(baseSake);
    const text = doc.body.textContent ?? "";

    expect(text).toContain("純米大吟醸");
    expect(text).toContain("華やか");
  });

  it("タグが4件以上でも先頭3件までに絞って表示する", () => {
    const doc = renderCard({
      ...baseSake,
      tags: [
        { id: "t1", name: "タグ1", category: "type", source: "manual" },
        { id: "t2", name: "タグ2", category: "taste", source: "manual" },
        { id: "t3", name: "タグ3", category: "taste", source: "manual" },
        { id: "t4", name: "タグ4", category: "taste", source: "manual" },
      ],
    });

    expect(doc.querySelectorAll("li")).toHaveLength(3);
    expect(doc.body.textContent).not.toContain("タグ4");
  });

  it("imageUrl があれば商品画像（img）を描画する（FR-09）", () => {
    const doc = renderCard({
      ...baseSake,
      imageUrl:
        "https://thumbnail.image.rakuten.co.jp/@0_mall/shop/bottle.jpg?_ex=400x400",
    });

    const img = doc.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toContain("獺祭 純米大吟醸 45");
  });

  it("imageUrl が null なら img を描画しない（画像なしレイアウト。FR-09）", () => {
    const doc = renderCard(baseSake);
    expect(doc.querySelector("img")).toBeNull();
  });

  it("名称に HTML 断片が含まれてもテキストとして描画する（危険な生 HTML を出さない）", () => {
    const doc = renderCard({
      ...baseSake,
      name: "<img src=x onerror=alert(1)>危険銘柄",
    });

    // React のエスケープにより img 要素は生成されない
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.body.textContent).toContain("危険銘柄");
  });
});
