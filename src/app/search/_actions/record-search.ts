"use server";

import { getCurrentUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { searchHistories } from "@/lib/db/schema";

import {
  type SearchCriteria,
  isEmptyCriteria,
} from "../_lib/build-search-query";

/**
 * 検索履歴の記録（Server Action）— FR-05 前半 / DESIGN §2.4。
 *
 * 検索結果ページに置いた Client Component（record-search-trigger）がマウント時に
 * fire-and-forget で呼ぶ。recordView と同じく RSC レンダリング中には記録しない
 * （プリフェッチ・ボットの多重記録回避。DESIGN §2.4 / 決定 D3）。
 *
 * filters スナップショット（DATABASE §2.7 / 決定 DB-5）:
 * - query（名前検索文字列）は search_histories.query カラムへ。名前条件なしなら null。
 * - filters（jsonb）には都道府県・タグ条件を SearchCriteria と同形で入れる
 *   （{"prefectureCode": "35", "tagNames": ["辛口"]}）。page は「その時点の条件」ではなく
 *   ページ送り状態なので filters に含めない（再検索は 1 ページ目から。DESIGN §4.1 の
 *   「検索条件のスナップショット」の趣旨）。
 *
 * 空条件（名前・都道府県・タグのいずれも指定なし）は記録しない（isEmptyCriteria）。
 * これは DATABASE §2.7 の CHECK（query IS NOT NULL OR filters <> '{}'）と対応し、
 * 「全件表示に等しい空検索」を履歴に残さないため（DESIGN §2.2 の空条件＝全件表示）。
 *
 * user_id 二段防御（DESIGN §6.2）: user_id は引数で受けず認証セッションから強制取得。
 * 未ログインは no-op。記録失敗は表示に影響させない（握りつぶさずログのみ）。
 */
export async function recordSearch(criteria: SearchCriteria): Promise<void> {
  // 空条件は記録しない（DATABASE §2.7 CHECK と対応）。0 件ヒットの検索は
  // 条件がある限り記録する（「探したが無かった」も嗜好情報。DESIGN §4.1）。
  if (isEmptyCriteria(criteria)) {
    return;
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return;
    }

    // filters には都道府県・タグ条件だけを SearchParams と同形で入れる。
    // 空のキーは省いて最小の jsonb にする（prefectureCode 未指定なら含めない）。
    const filters: { prefectureCode?: string; tagNames?: string[] } = {};
    if (criteria.prefectureCode !== undefined) {
      filters.prefectureCode = criteria.prefectureCode;
    }
    if (criteria.tagNames.length > 0) {
      filters.tagNames = criteria.tagNames;
    }

    await getDb()
      .insert(searchHistories)
      .values({
        userId: user.id,
        query: criteria.q ?? null,
        filters,
      });
  } catch (error) {
    // fire-and-forget の記録失敗は表示に影響させない。握りつぶさずログに残す。
    console.error("[recordSearch] 検索履歴の記録に失敗しました", error);
  }
}
