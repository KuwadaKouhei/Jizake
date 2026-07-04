import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * DB クライアント（サーバ専用）。
 *
 * - 接続情報は環境変数 DATABASE_URL でのみ扱う（シークレット直書き禁止）。
 * - Client Component から import してはならない（呼び出せるのは RSC・Server
 *   Actions・Route Handler・scripts/ のバッチのみ。DIRECTORY_STRUCTURE §5.2）。
 * - `server-only` パッケージを使わないのは scripts/（tsx バッチ）からも
 *   共用するため。
 * - Supabase のコネクションプーラ（Supavisor）は prepared statements に
 *   対応しないため prepare: false を指定する。
 */

type Db = ReturnType<typeof createDb>;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "環境変数 DATABASE_URL が設定されていません（.env.example 参照）",
    );
  }
  return drizzle(postgres(url, { prepare: false }), { schema });
}

let cached: Db | undefined;

/** 接続クライアントを取得する（プロセス内シングルトン・遅延初期化）。 */
export function getDb(): Db {
  cached ??= createDb();
  return cached;
}
