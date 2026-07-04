import { asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { cache } from "react";

import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { tags } from "@/lib/db/schema";

/**
 * タグの横断読み取りクエリ。
 *
 * 検索フォーム（/search）の味タグ候補表示に使う。将来のタグ別一覧（/tags/[name]）や
 * 推薦の根拠タグ表示でも共用しうる横断クエリのため、DIRECTORY_STRUCTURE のツリー
 * （src/lib/db/queries/tags.ts）どおり共有クエリとして置く（DIR-6: 複数機能から使う読み取り）。
 *
 * 依存方向（§5.2）: データアクセス層のため UI の型を知らない。
 */

/** タグ候補 1 件（検索フォームのチェックボックス等に載せる最小要約）。 */
export type TagOption = {
  id: string;
  name: string;
  category: string;
};

// PostgresJsDatabase（本番）と PgliteDatabase（テスト）の両方を受ける共通型。
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * 指定カテゴリのタグ一覧を name 昇順で取得する（db を明示的に受ける下位関数）。
 * テストでは PGlite を差し込むためにこちらを直接呼ぶ。
 *
 * DATABASE §2.3: category は 'taste'（味わい）/ 'type'（種別）。検索フォームの
 * 味タグ候補は category='taste' を渡す。
 */
export async function selectTagsByCategory(
  db: Db,
  category: string,
): Promise<TagOption[]> {
  return db
    .select({ id: tags.id, name: tags.name, category: tags.category })
    .from(tags)
    .where(eq(tags.category, category))
    .orderBy(asc(tags.name));
}

/**
 * 味タグ（category='taste'）の候補一覧を取得する（RSC から直接呼ぶ公開関数）。
 *
 * 同一リクエスト内で重複呼び出しされても DB クエリが二重に走らないよう
 * React.cache でメモ化する（他の公開クエリと同型）。
 */
export const getTasteTagOptions = cache((): Promise<TagOption[]> =>
  selectTagsByCategory(getDb(), "taste"),
);
