import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Next.js と同じ規約（.env.local 等）で環境変数を読む
loadEnvConfig(process.cwd());

/**
 * drizzle-kit 設定。
 * - generate（SQL 生成）は DATABASE_URL 不要。
 * - migrate（適用）は .env.local 等で DATABASE_URL を設定して実行する
 *   （npm run db:migrate。手順は .env.example 参照）。
 */

// DB 接続を要するサブコマンドは、未設定のままダミー URL へ接続して
// 分かりにくい接続エラーになる前に、明確なメッセージで失敗させる
// （T02 レビュー Consider の引き継ぎ対応）。
const commandsRequiringDb = ["migrate", "push", "pull", "studio"];
if (
  !process.env.DATABASE_URL &&
  process.argv.some((arg) => commandsRequiringDb.includes(arg))
) {
  throw new Error(
    "環境変数 DATABASE_URL が設定されていません。.env.local に接続文字列を設定してから実行してください（手順は .env.example 参照）",
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // generate 時は未設定でよいためダミーを許容する（DB 接続系は上でガード済み）
    url: process.env.DATABASE_URL ?? "postgres://unset:unset@localhost/unset",
  },
});
