import { count, desc, eq } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import {
  PAGE_SIZE,
  type CatalogDb,
  type SakeSummary,
  selectTagsBySakeIds,
} from "@/lib/db/queries/sakes";
import {
  breweries,
  sakes,
  searchHistories,
  viewHistories,
} from "@/lib/db/schema";

/**
 * 履歴の本人限定読み取りクエリ（/history 専用）。
 *
 * DIRECTORY_STRUCTURE §3・DIR-3: 履歴一覧は /history からしか使わない機能固有クエリのため
 * セグメント配下の _lib に置く（横断カタログクエリ src/lib/db/queries には昇格しない）。
 *
 * user_id 二段防御（DESIGN §6.2 / DATABASE §4.1）:
 * - 主防御（一段目）: **公開関数 getViewHistoryPage / getSearchHistoryPage は user_id を引数で
 *   受け取らず**、必ず認証セッション（getCurrentUser）から取得して WHERE に適用する。
 *   呼び出し側（RSC）が他人の ID を渡せない構造にする。未ログインは呼ばない前提だが、
 *   セッションが取れなければ空を返して安全側に倒す。
 * - 二段目（defense-in-depth）: RLS の本人限定 SELECT ポリシー（DATABASE §4.2）。
 *
 * 下位の select* 関数は db と userId を引数で受けてテスト可能にする（PGlite を差し込む）。
 * これらは公開関数からのみ userId を渡され、他人の user_id を渡す経路は UI に露出しない。
 */

/** 閲覧履歴 1 件（銘柄要約＋閲覧日時）。 */
export type ViewHistoryEntry = {
  /** 履歴行の PK（同一銘柄を複数回閲覧しても行ごとに一意なため key に使える）。 */
  id: string;
  sake: SakeSummary;
  viewedAt: Date;
};

/** 閲覧履歴 1 ページ分（総件数でページャを描く。カタログ一覧と同型）。 */
export type ViewHistoryPage = {
  entries: ViewHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
};

/** 検索履歴 1 件（再検索リンク生成に使う条件スナップショット＋検索日時）。 */
export type SearchHistoryEntry = {
  id: string;
  /** 名前検索文字列（名前条件なしの検索では null）。 */
  query: string | null;
  /** 検索条件スナップショット（DATABASE §2.7: SearchParams と同形の jsonb）。 */
  filters: unknown;
  searchedAt: Date;
};

/** 検索履歴 1 ページ分。 */
export type SearchHistoryPage = {
  entries: SearchHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * 指定ユーザーの閲覧履歴を新しい順に 1 ページ分取得する（db・userId を明示的に受ける下位関数）。
 * テストでは PGlite を差し込むためにこちらを直接呼ぶ。
 *
 * - view_histories を user_id で絞り（index 5: user_id, viewed_at DESC）、銘柄＋蔵元を INNER JOIN。
 * - viewed_at 降順（同時刻は履歴 id で決定的に）。同一銘柄の複数回閲覧はそれぞれ別行として返す。
 * - タグはそのページ分の銘柄 ID だけを selectTagsBySakeIds に渡して 1 クエリ一括取得（N+1 回避）。
 */
export async function selectViewHistory(
  db: CatalogDb,
  userId: string,
  page = 1,
): Promise<ViewHistoryPage> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(viewHistories)
    .where(eq(viewHistories.userId, userId));

  const rows = await db
    .select({
      id: viewHistories.id,
      viewedAt: viewHistories.viewedAt,
      sakeId: sakes.id,
      name: sakes.name,
      breweryName: breweries.name,
      prefectureCode: breweries.prefectureCode,
    })
    .from(viewHistories)
    .innerJoin(sakes, eq(sakes.id, viewHistories.sakeId))
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(eq(viewHistories.userId, userId))
    .orderBy(desc(viewHistories.viewedAt), desc(viewHistories.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const tagsBySakeId = await selectTagsBySakeIds(
    db,
    rows.map((row) => row.sakeId),
  );

  return {
    entries: rows.map((row) => ({
      id: row.id,
      viewedAt: row.viewedAt,
      sake: {
        id: row.sakeId,
        name: row.name,
        breweryName: row.breweryName,
        prefectureCode: row.prefectureCode,
        tags: tagsBySakeId.get(row.sakeId) ?? [],
      },
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * 指定ユーザーの検索履歴を新しい順に 1 ページ分取得する（db・userId を明示的に受ける下位関数）。
 * テストでは PGlite を差し込むためにこちらを直接呼ぶ。
 *
 * - search_histories を user_id で絞り（index 7: user_id, searched_at DESC）searched_at 降順。
 * - filters は jsonb をそのまま返す（再検索リンクは表示側で SearchCriteria に読み替える）。
 */
export async function selectSearchHistory(
  db: CatalogDb,
  userId: string,
  page = 1,
): Promise<SearchHistoryPage> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(searchHistories)
    .where(eq(searchHistories.userId, userId));

  const rows = await db
    .select({
      id: searchHistories.id,
      query: searchHistories.query,
      filters: searchHistories.filters,
      searchedAt: searchHistories.searchedAt,
    })
    .from(searchHistories)
    .where(eq(searchHistories.userId, userId))
    .orderBy(desc(searchHistories.searchedAt), desc(searchHistories.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    entries: rows.map((row) => ({
      id: row.id,
      query: row.query,
      filters: row.filters,
      searchedAt: row.searchedAt,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * 現在のログインユーザーの閲覧履歴を 1 ページ分取得する（RSC から呼ぶ公開関数）。
 * user_id は認証セッションから強制取得する（主防御。引数で受けない）。
 * 未ログイン時は空ページを返す（呼び出し元の /history は middleware・ページ側で
 * 既に未ログインを弾いているが、ここでも空に倒して他人の履歴が漏れない構造にする）。
 */
export async function getViewHistoryPage(page = 1): Promise<ViewHistoryPage> {
  const user = await getCurrentUser();
  if (!user) {
    return { entries: [], total: 0, page, pageSize: PAGE_SIZE };
  }
  return selectViewHistory(getDb(), user.id, page);
}

/**
 * 現在のログインユーザーの検索履歴を 1 ページ分取得する（RSC から呼ぶ公開関数）。
 * user_id は認証セッションから強制取得する（主防御。引数で受けない）。
 */
export async function getSearchHistoryPage(
  page = 1,
): Promise<SearchHistoryPage> {
  const user = await getCurrentUser();
  if (!user) {
    return { entries: [], total: 0, page, pageSize: PAGE_SIZE };
  }
  return selectSearchHistory(getDb(), user.id, page);
}
