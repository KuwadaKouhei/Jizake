import { findPrefectureByCode } from "@/lib/constants/prefectures";
import { type SearchCriteria, toSearchQueryString } from "@/lib/search-query";

import type { SearchHistoryEntry } from "./queries";

/**
 * 履歴表示の純関数（日時整形・検索履歴 → 再検索リンク・条件ラベル）。
 *
 * DIRECTORY_STRUCTURE §3: /history 専用の表示ロジックのためセグメント配下の _lib に置く。
 * UI・DB に依存しない純関数として切り出し、ユニットテスト対象にする（TEST_PHILOSOPHY）。
 */

/**
 * timestamptz（UTC 保存）を JST の「YYYY/MM/DD HH:mm」に整形する（DATABASE §1.2: 表示側で JST）。
 * Intl は環境ロケールに依存するため、桁を自前で組んで決定的な文字列にする。
 */
export function formatViewedAt(at: Date): string {
  // UTC から JST（+9h）へ。getUTC* に 9 時間を足して各桁を取り出す。
  const jst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const mi = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${y}/${mo}/${d} ${h}:${mi}`;
}

/**
 * 検索履歴の jsonb filters を、信頼できる形の一部だけ取り出して読み取る。
 * filters は過去にサーバ側 recordSearch が書いた値だが、DB 内容も境界として扱い、
 * prefectureCode（string）と tagNames（string[]）のみを型安全に拾う。
 */
function readFilters(filters: unknown): {
  prefectureCode?: string;
  tagNames: string[];
} {
  const result: { prefectureCode?: string; tagNames: string[] } = {
    tagNames: [],
  };
  if (filters === null || typeof filters !== "object") {
    return result;
  }
  const obj = filters as Record<string, unknown>;
  if (typeof obj.prefectureCode === "string") {
    result.prefectureCode = obj.prefectureCode;
  }
  if (Array.isArray(obj.tagNames)) {
    result.tagNames = obj.tagNames.filter(
      (t): t is string => typeof t === "string",
    );
  }
  return result;
}

/** 検索履歴 1 件を、再検索用の SearchCriteria に読み替える（純関数）。 */
export function searchHistoryToCriteria(
  entry: SearchHistoryEntry,
): SearchCriteria {
  const { prefectureCode, tagNames } = readFilters(entry.filters);
  return {
    q: entry.query ?? undefined,
    prefectureCode,
    tagNames,
    page: 1,
  };
}

/** 検索履歴 1 件を再検索する `/search?...` の href を組み立てる（純関数）。 */
export function searchHistoryToHref(entry: SearchHistoryEntry): string {
  return `/search${toSearchQueryString(searchHistoryToCriteria(entry))}`;
}

/**
 * 検索履歴 1 件を人間可読なラベル片の配列にする（純関数）。
 * 例: ["名前: 獺祭", "山口県", "辛口", "淡麗"]。UI はこれをバッジ等で並べる。
 * 都道府県コードは定数マスタで県名に変換する（不正コードは表示しない）。
 */
export function searchHistoryToLabels(entry: SearchHistoryEntry): string[] {
  const criteria = searchHistoryToCriteria(entry);
  const labels: string[] = [];
  if (criteria.q !== undefined) {
    labels.push(`名前: ${criteria.q}`);
  }
  if (criteria.prefectureCode !== undefined) {
    const prefecture = findPrefectureByCode(criteria.prefectureCode);
    if (prefecture) {
      labels.push(prefecture.name);
    }
  }
  for (const tagName of criteria.tagNames) {
    labels.push(tagName);
  }
  return labels;
}
