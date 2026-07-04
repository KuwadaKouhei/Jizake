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
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // generate 時は未設定でよいためダミーを許容し、migrate 時に実値を要求する
    url: process.env.DATABASE_URL ?? "postgres://unset:unset@localhost/unset",
  },
});
