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
 *   共用するため。代わりに下の実行時ガードで誤 import を即座に検出する。
 * - Supabase のコネクションプーラ（Supavisor）は transaction mode で
 *   prepared statements に対応しないため prepare: false を指定する。
 */

if (typeof window !== "undefined") {
  throw new Error(
    "src/lib/db/client.ts はサーバ専用です（Client Component から import 禁止。DIRECTORY_STRUCTURE §5.2）",
  );
}

type Db = ReturnType<typeof createDb>;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "環境変数 DATABASE_URL が設定されていません（.env.example 参照）",
    );
  }
  const client = postgres(url, {
    prepare: false,
    // サーバレスはインスタンス毎に独立プールを持つため既定 max=10 だと
    // 接続枯渇する。多重化はプーラ側に任せ、プロセスあたり 1 本を既定とする。
    // scripts/ のバッチで並列度が欲しい場合は DB_POOL_MAX で引き上げる。
    max: Number(process.env.DB_POOL_MAX ?? 1),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { db: drizzle(client, { schema }), client };
}

// dev の HMR でモジュールが再評価されても旧プールをリークさせないよう
// globalThis にキャッシュする（Drizzle/Prisma 公式ドキュメントと同型）。
const globalForDb = globalThis as unknown as {
  __jizakeDb?: ReturnType<typeof createDb>;
};

function getOrCreate() {
  globalForDb.__jizakeDb ??= createDb();
  return globalForDb.__jizakeDb;
}

/** 接続クライアントを取得する（プロセス内シングルトン・遅延初期化）。 */
export function getDb(): Db["db"] {
  return getOrCreate().db;
}

/**
 * 接続プールを閉じる。scripts/ のバッチは終了前に必ず呼ぶこと
 * （postgres.js はアイドル接続を保持するため、呼ばないとプロセスが終了しない）。
 */
export async function closeDb(): Promise<void> {
  const cached = globalForDb.__jizakeDb;
  if (cached) {
    globalForDb.__jizakeDb = undefined;
    await cached.client.end();
  }
}
