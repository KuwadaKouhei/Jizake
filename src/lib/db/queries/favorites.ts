import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { breweries, favorites, sakes } from "@/lib/db/schema";

import { isValidSakeId, type SakeSummary, selectTagsBySakeIds } from "./sakes";

/**
 * お気に入り（favorites）の読み取り・書き込みクエリ（T25 / FR-10）。
 *
 * DIRECTORY_STRUCTURE §3 / DIR-6: 複数機能（詳細ページの状態表示・お気に入り一覧・
 * トグル Server Action）から使うため共有クエリとして src/lib/db/queries に置く。
 *
 * セキュリティ（DESIGN §6.2・view_histories と同型）:
 * - user_id は呼び出し側（Server Action / RSC）が認証セッションから取得して渡す。
 *   クライアントから user_id を受けない（他人の favorites を操作する経路を作らない）。
 * - RLS（favorites_own_select）は二段目の防御。書き込みはサーバ接続経由のみ。
 */

// PostgresJsDatabase（本番）と PgliteDatabase（テスト）の両方を受ける共通型。
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** 指定ユーザーが指定銘柄をお気に入り登録しているか（db を受ける下位関数）。 */
export async function selectIsFavorite(
  db: Db,
  userId: string,
  sakeId: string,
): Promise<boolean> {
  if (!isValidSakeId(sakeId)) {
    return false;
  }
  const rows = await db
    .select({ sakeId: favorites.sakeId })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.sakeId, sakeId)))
    .limit(1);
  return rows.length > 0;
}

/** RSC から呼ぶ公開関数（本番 DB）。未ログイン時は呼び出し側で false に倒す。 */
export function isFavorite(userId: string, sakeId: string): Promise<boolean> {
  return selectIsFavorite(getDb(), userId, sakeId);
}

/**
 * お気に入りを追加/削除して、操作後の状態（true=登録済み）を返す（db を受ける下位関数）。
 *
 * 冪等トグル: すでに登録済みなら削除して false、未登録なら追加して true。
 * 追加は ON CONFLICT DO NOTHING で二重登録に耐える（複合 PK）。
 */
export async function toggleFavoriteRow(
  db: Db,
  userId: string,
  sakeId: string,
): Promise<boolean> {
  const already = await selectIsFavorite(db, userId, sakeId);
  if (already) {
    await db
      .delete(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.sakeId, sakeId)));
    return false;
  }
  await db.insert(favorites).values({ userId, sakeId }).onConflictDoNothing();
  return true;
}

/** お気に入り一覧（新しい順）を SakeSummary で返す（db を受ける下位関数）。 */
export async function selectFavoriteSakes(
  db: Db,
  userId: string,
): Promise<SakeSummary[]> {
  const rows = await db
    .select({
      id: sakes.id,
      name: sakes.name,
      breweryName: breweries.name,
      prefectureCode: breweries.prefectureCode,
      imageUrl: sakes.imageUrl,
    })
    .from(favorites)
    .innerJoin(sakes, eq(sakes.id, favorites.sakeId))
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(eq(favorites.userId, userId))
    .orderBy(desc(favorites.createdAt), desc(favorites.sakeId));

  const tagsBySakeId = await selectTagsBySakeIds(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    breweryName: row.breweryName,
    prefectureCode: row.prefectureCode,
    imageUrl: row.imageUrl,
    tags: tagsBySakeId.get(row.id) ?? [],
  }));
}

/** RSC（/favorites）から呼ぶ公開関数（本番 DB）。 */
export function getFavoriteSakes(userId: string): Promise<SakeSummary[]> {
  return selectFavoriteSakes(getDb(), userId);
}
