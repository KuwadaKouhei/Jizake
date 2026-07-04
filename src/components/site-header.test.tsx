// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteHeader } from "@/components/site-header";

afterEach(cleanup);

describe("SiteHeader", () => {
  it("サイト名 Jizake がホームへのリンクとして表示される", () => {
    render(<SiteHeader />);

    const brand = screen.getByRole("link", { name: "Jizake" });

    expect(brand.getAttribute("href")).toBe("/");
  });

  it("メインナビゲーションにホームへの導線がある", () => {
    render(<SiteHeader />);

    const nav = screen.getByRole("navigation", {
      name: "メインナビゲーション",
    });
    const home = within(nav).getByRole("link", { name: "ホーム" });

    expect(home.getAttribute("href")).toBe("/");
  });

  it("実装済みの都道府県別一覧（/prefectures）への導線がある（T06）", () => {
    render(<SiteHeader />);

    const nav = screen.getByRole("navigation", {
      name: "メインナビゲーション",
    });
    const prefectures = within(nav).getByRole("link", { name: "地酒を探す" });

    expect(prefectures.getAttribute("href")).toBe("/prefectures");
  });

  it("未実装機能への導線を出さない（TASKS 運用ルール: 許可リストのみ）", () => {
    render(<SiteHeader />);

    // 実装済みで導線を出してよいのはホームと都道府県別一覧のみ（T06 時点）。
    const allowed = new Set(["/", "/prefectures"]);
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(allowed.has(href ?? "")).toBe(true);
    }
  });
});
