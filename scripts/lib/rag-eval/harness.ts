import { inArray } from "drizzle-orm";

import type { CatalogDb } from "@/lib/db/queries/sakes";
import { type EmbedQueryFn, retrieveSakeCandidates } from "@/lib/rag/retriever";
import { sakes } from "@/lib/db/schema";

import { type EvalCase } from "./eval-set";
import {
  type AggregateMetrics,
  aggregateMetrics,
  evaluateQuery,
  type QueryEvalResult,
} from "./metrics";

/**
 * RAG 精度 PoC の評価ハーネス中核（TASKS T13②）。
 *
 * retriever（src/lib/rag）に埋め込み関数を注入して評価セットを走らせ、recall@k / MRR /
 * hit@k を計算する。埋め込み関数は EmbedQueryFn で注入するため、実キーがあれば embedText
 * （実 API）、無ければ決定的ダミー（fake-embedding.ts）で動く（指示: 実/ダミー両対応）。
 * DB は CatalogDb を注入するため PGlite でユニット統合テストできる（TEST_PHILOSOPHY）。
 *
 * retriever の公開シグネチャ・戻り値は変えない（この層は retriever を呼ぶだけ）。
 * 配置は使い捨ての PoC 資産（scripts/lib）で本番バンドルに入れない（DIRECTORY_STRUCTURE §3）。
 */

/** 1 質問ぶんの評価詳細（デバッグ・レポート表示用）。 */
export type CaseReport = {
  label: string;
  /** 期待銘柄のうち DB に実在し ID 解決できた数（0 なら評価不能＝評価セットの typo 疑い）。 */
  resolvedExpectedCount: number;
  /** retriever が返した候補数。 */
  candidateCount: number;
  result: QueryEvalResult;
};

/** 評価セット全体のレポート。 */
export type EvalReport = {
  k: number;
  cases: CaseReport[];
  metrics: AggregateMetrics;
  /**
   * ID 解決できなかった（DB に無い）期待銘柄名。空でなければ評価セットと seed-data の
   * 不整合（typo・未投入）であり、指標の信頼性が落ちる。呼び出し側で警告する。
   */
  unresolvedExpectedNames: string[];
};

/**
 * 銘柄名 → id の対応表を DB から引く。評価セットの期待銘柄名を実在 ID へ解決するために使う。
 * 同名銘柄が複数あれば全 ID を返す（seed-data は (蔵元, 名前) で一意だが名前だけでは
 * 重複しうるため配列で持つ）。
 */
async function loadSakeIdsByName(
  db: CatalogDb,
  names: readonly string[],
): Promise<Map<string, string[]>> {
  const byName = new Map<string, string[]>();
  if (names.length === 0) {
    return byName;
  }
  const rows = await db
    .select({ id: sakes.id, name: sakes.name })
    .from(sakes)
    .where(inArray(sakes.name, [...names]));
  for (const row of rows) {
    const list = byName.get(row.name) ?? [];
    list.push(row.id);
    byName.set(row.name, list);
  }
  return byName;
}

/**
 * 評価セットを走らせて指標を計算する。
 *
 * - db: 評価対象 DB（PGlite または実 Supabase）。
 * - embedQuery: クエリ埋め込み関数（実 API or 決定的ダミー）。retriever へ注入する。
 * - cases: 評価セット（eval-set.ts）。
 * - k: recall@k / hit@k の k（既定 5）。
 *
 * 各質問について retriever を呼び、返った候補 ID の順位列と、期待銘柄名から解決した
 * 実在 ID 集合を metrics.ts の純関数で突き合わせる。retriever には評価用に十分な候補数を
 * 返させる（limit を max(k, retriever 既定) 以上にする）。
 */
export async function runEval(
  db: CatalogDb,
  embedQuery: EmbedQueryFn,
  cases: readonly EvalCase[],
  k = 5,
): Promise<EvalReport> {
  const allExpectedNames = new Set<string>();
  for (const c of cases) {
    for (const name of c.expectedSakeNames) {
      allExpectedNames.add(name);
    }
  }
  const idsByName = await loadSakeIdsByName(db, [...allExpectedNames]);

  const unresolved = new Set<string>();
  const caseReports: CaseReport[] = [];
  const results: QueryEvalResult[] = [];

  for (const c of cases) {
    const expectedIds = new Set<string>();
    for (const name of c.expectedSakeNames) {
      const ids = idsByName.get(name);
      if (ids === undefined || ids.length === 0) {
        unresolved.add(name);
        continue;
      }
      for (const id of ids) {
        expectedIds.add(id);
      }
    }

    // 上位 k を評価するため、retriever には少なくとも k 件返させる。
    const candidates = await retrieveSakeCandidates(db, embedQuery, {
      ...c.query,
      limit: Math.max(k, c.query.limit ?? 0),
    });
    const rankedIds = candidates.map((cand) => cand.sake.id);

    const result = evaluateQuery(rankedIds, expectedIds, k);
    results.push(result);
    caseReports.push({
      label: c.label,
      resolvedExpectedCount: expectedIds.size,
      candidateCount: candidates.length,
      result,
    });
  }

  return {
    k,
    cases: caseReports,
    metrics: aggregateMetrics(results),
    unresolvedExpectedNames: [...unresolved],
  };
}
