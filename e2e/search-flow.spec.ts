import { expect, test } from "@playwright/test";

import { hasDatabase } from "./_support/env";

/**
 * 導線①: 検索→一覧→詳細（FR-06 / FR-07 / FR-02 の回帰保証）。
 *
 * DB 有無での分割（TASKS T16・playwright.config.ts の方針）:
 * - 安定動線（DB 無しでも 200）: /prefectures の県選択 UI が表示され、県リンクが 47 個ある。
 *   これは DB 非依存の静的ページで、キー・実データ無しの CI でも常に通す。
 * - フルフロー（要 DATABASE_URL）: /search でフォーム→検索実行→結果カード→詳細ページ遷移、
 *   /prefectures/[code] の一覧→カードから詳細。これらは実データを引くため 500 になる環境が
 *   あり、DB があるときだけ実行する（test.skip(!hasDatabase)）。
 */

test.describe("導線① 検索→一覧→詳細（安定動線）", () => {
  test("/prefectures で県選択 UI が表示され、県リンクから一覧へ入れる", async ({
    page,
  }) => {
    await page.goto("/prefectures");

    // 見出し（role/text ベースの待機）。DB 非依存で常に描画される。
    await expect(
      page.getByRole("heading", { name: "都道府県から地酒を探す", level: 1 }),
    ).toBeVisible();

    // 47 都道府県のリンクが並ぶ（/prefectures/<code> への遷移入口）。
    const prefectureLinks = page.locator('a[href^="/prefectures/"]');
    await expect(prefectureLinks).toHaveCount(47);

    // 代表として東京都のリンクが正しい href を持つ（JIS コード 13）。
    await expect(page.getByRole("link", { name: "東京都" })).toHaveAttribute(
      "href",
      "/prefectures/13",
    );
  });
});

test.describe("導線① 検索→一覧→詳細（フルフロー・要 DATABASE_URL）", () => {
  test.skip(
    !hasDatabase,
    "DATABASE_URL 未設定。/search・一覧・詳細は実データを引くため DB がある環境でのみ実行する。",
  );

  test("/search で検索フォーム→実行→結果カード→詳細ページへ遷移できる", async ({
    page,
  }) => {
    await page.goto("/search");

    await expect(
      page.getByRole("heading", { name: "日本酒を検索", level: 1 }),
    ).toBeVisible();

    // 名前で検索する（GET フォーム。送信で ?q= に反映）。
    await page.getByLabel("名前・読み").fill("獺祭");
    await page.getByRole("button", { name: "検索する" }).click();

    await expect(page).toHaveURL(/\/search\?.*q=/);

    // 結果カードのいずれかの詳細リンク（/sake/<id>）へ遷移する。
    const firstDetailLink = page.locator('a[href^="/sake/"]').first();
    await expect(firstDetailLink).toBeVisible();
    await firstDetailLink.click();

    // 詳細ページに到達（URL が /sake/<uuid>）。
    await expect(page).toHaveURL(/\/sake\/[0-9a-f-]{36}/);
    // 詳細ページには銘柄見出し（h1）がある。
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("/prefectures/[code] の一覧からカードで詳細へ遷移できる", async ({
    page,
  }) => {
    // 兵庫県（28）は代表的な酒どころで銘柄が存在する見込み。0 件なら空状態を確認する。
    await page.goto("/prefectures/28");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const detailLinks = page.locator('a[href^="/sake/"]');
    const count = await detailLinks.count();

    if (count > 0) {
      await detailLinks.first().click();
      await expect(page).toHaveURL(/\/sake\/[0-9a-f-]{36}/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    } else {
      // 実データが未投入の県でも空状態メッセージで画面は成立する（FR-06 の 0 件挙動と同型）。
      await expect(page.getByText(/見つかりません|ありません/)).toBeVisible();
    }
  });
});
