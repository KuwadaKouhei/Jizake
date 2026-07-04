import { defineConfig, devices } from "@playwright/test";

/**
 * E2E テストの設定（主要 3 導線: 検索→一覧→詳細・ログイン・チャット。TEST_PHILOSOPHY）。
 *
 * webServer（T05 申し送り: dev → build&start へ切替）:
 * - 本番挙動（`next build && next start`）でビルド済みアプリを起動して E2E を回す
 *   （キャッシュ・RSC・ストリーミングの挙動を dev と分けない）。
 * - ビルドは重いため CI では E2E ジョブを unit から分離する（ci.yml の e2e ジョブ）。
 * - 既に別ポートで起動済みのサーバがあれば `PLAYWRIGHT_BASE_URL` で指し、build&start を
 *   スキップできる（ローカルで反復するときのため）。
 *
 * 実データ/実キーの前提（自律実行モードの制約）:
 * - `DATABASE_URL` / `AI_GATEWAY_API_KEY` が無い環境では、DB/LLM に依存する画面
 *   （/・/search・/sake/[id]・/prefectures/[code]）が 500 になる。フルフロー spec は
 *   各 spec 冒頭で `test.skip(!process.env.X)` により条件付きスキップする。
 * - DB/キー無しでも到達できる安定動線（/prefectures・/login・/signup・/chat・
 *   未ログインの /history ガード）は常に検証する。詳細は e2e/README.md を参照。
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 1 ブラウザで直列に十分回る規模。CI の共有ランナーで安定させるためワーカーを絞る。
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // 外部の起動済みサーバを指すときは build&start をスキップする（PLAYWRIGHT_BASE_URL 指定時）。
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // 本番挙動で起動する（T05 申し送り: dev → build&start）。CI でもローカルでも同じ経路。
        command: `npm run build && npm run start -- --port ${PORT}`,
        // readiness 判定はトップ（/）に向けない: DB/キー無しの環境では / が 500 になるため、
        // Playwright が「サーバ未 ready」と誤判定してタイムアウトする。DB 非依存で必ず 200 を
        // 返す静的ページ（/prefectures）を ready の目印にする（実データ有無に関わらず起動判定できる）。
        url: `${baseURL}/prefectures`,
        reuseExistingServer: !process.env.CI,
        // build を含むため既定 60 秒では足りない。
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
