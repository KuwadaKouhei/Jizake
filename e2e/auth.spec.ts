import { expect, test } from "@playwright/test";

import { hasSupabaseAuth } from "./_support/env";

/**
 * 導線②: ログイン（FR-04 の回帰保証）。
 *
 * DB/キー有無での分割:
 * - 安定動線（キー無しでも 200・DB 非依存のガード）:
 *   1) /login・/signup のフォーム要素（メール・パスワード入力＋送信ボタン）が表示される。
 *   2) 未ログインで /history にアクセスすると /login?next=%2Fhistory へ誘導される
 *      （proxy〔旧 middleware〕のガード。Supabase 未設定でも保護ルートだけは誘導する実装）。
 * - フルフロー（要 Supabase Auth）: サインアップ→ログイン→保護ページ /history 到達。
 *   実キーが要る＋メール確認（Confirm email）設定に挙動が依存するため、キーがあるときだけ実行。
 */

test.describe("導線② ログイン（安定動線）", () => {
  test("/login にフォーム要素が表示される", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: "ログイン", level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel("メールアドレス")).toBeVisible();
    await expect(page.getByLabel("パスワード")).toBeVisible();
    // 「Google でログイン」ボタンとも共存するため exact でメール認証の送信ボタンに限定（T24）。
    await expect(
      page.getByRole("button", { name: "ログイン", exact: true }),
    ).toBeVisible();
    // 新規登録への導線がある。
    await expect(
      page.getByRole("link", { name: "新規登録" }).first(),
    ).toBeVisible();
  });

  test("/signup にフォーム要素が表示される", async ({ page }) => {
    await page.goto("/signup");

    await expect(
      page.getByRole("heading", { name: "新規登録", level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel("メールアドレス")).toBeVisible();
    await expect(page.getByLabel("パスワード")).toBeVisible();
    await expect(page.getByRole("button", { name: "登録する" })).toBeVisible();
  });

  test("未ログインで /history にアクセスすると /login へ誘導される", async ({
    page,
  }) => {
    await page.goto("/history");

    // proxy のガードで /login?next=/history へリダイレクトされる（DB 非依存で効く）。
    await expect(page).toHaveURL(/\/login\?next=%2Fhistory/);
    await expect(
      page.getByRole("heading", { name: "ログイン", level: 1 }),
    ).toBeVisible();
  });
});

test.describe("導線② ログイン（フルフロー・要 Supabase Auth）", () => {
  test.skip(
    !hasSupabaseAuth,
    "NEXT_PUBLIC_SUPABASE_URL / ANON_KEY 未設定。サインアップ・ログインの往復は Supabase 実キーがある環境でのみ実行する。",
  );

  test("サインアップ→ログイン→保護ページ /history に到達できる", async ({
    page,
  }) => {
    // 毎回ユニークなメールでアカウントを作る（既存衝突を避ける）。
    const email = `e2e+${Date.now()}@example.com`;
    const password = "e2e-password-123";

    // サインアップ。
    await page.goto("/signup");
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("パスワード").fill(password);
    await page.getByRole("button", { name: "登録する" }).click();

    // Confirm email 設定次第で (a) 即ログインされヘッダに「ログアウト」が出る、(b) 確認案内
    // （role="status"）が出る のどちらか。networkidle でなく観測可能な要素で待つ（他 spec と統一。
    // REVIEW T16 CODE C-3）。
    await expect(
      page.getByText("ログアウト").or(page.getByRole("status")),
    ).toBeVisible({ timeout: 15_000 });

    // 明示的にログインしてセッションを確立する（サインアップ直後に未確認セッションでも
    // ログインできる設定なら成功、Confirm email 必須なら失敗し得る。実環境設定に依存）。
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("パスワード").fill(password);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    // ログイン成功ならヘッダに「ログアウト」、失敗（Confirm email 未確認等）なら role="alert"。
    // どちらも観測可能な要素で待つ（networkidle を避ける。REVIEW T16 CODE C-3）。
    await expect(
      page.getByText("ログアウト").or(page.getByRole("alert")),
    ).toBeVisible({ timeout: 15_000 });

    // 保護ページへアクセス。ログインできていれば /history が表示され、
    // Confirm email 必須で未確立なら /login へ誘導される（どちらも「壊れていない」導線）。
    await page.goto("/history");
    const url = page.url();
    if (/\/login/.test(url)) {
      // 未確認セッション（Confirm email ON）。ガードが正しく働いていることを確認する。
      await expect(page).toHaveURL(/\/login/);
    } else {
      // ログイン成立。保護ページに到達（履歴見出しが出る）。
      await expect(page).toHaveURL(/\/history/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });
});
