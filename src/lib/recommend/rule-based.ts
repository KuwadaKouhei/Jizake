import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import {
  type CatalogDb,
  type SakeSummary,
  selectTagsBySakeIds,
} from "@/lib/db/queries/sakes";
import {
  breweries,
  sakeTags,
  sakes,
  searchHistories,
  tags,
  viewHistories,
} from "@/lib/db/schema";

import {
  buildPreferenceProfile,
  scoreCandidates,
  type HistoryEvent,
  type PreferenceProfile,
  type ScoreCandidate,
  type ScoringWeights,
} from "./scoring";
import type { RecommendReason, RecommendedSake } from "./types";

/**
 * 履歴ベース推薦の初期実装（ルールベース。DESIGN §2.5 / §4.2）。
 *
 * 差し替え可能な知能（PLAN_PHILOSOPHY 原則3）: このファイルは `types.ts` の固定 IF の
 * 一実装にすぎない。将来 協調フィルタリング等へ差し替える際は同ディレクトリに別ファイルを
 * 足し index.ts のエクスポート先を変えるだけで、呼び出し側（ホーム）は無変更
 * （DIRECTORY_STRUCTURE 例2）。
 *
 * 流れ（DESIGN §4.2）:
 * 1. userId が null、または履歴がしきい値未満 → 人気ランキング（popularity_rank）にランダム性を
 *    加えてフォールバック（コールドスタート。reason: popular）。
 * 2. 履歴が十分ある場合:
 *    a. 直近の閲覧・検索履歴からタグ・都道府県の時間減衰つき頻度（嗜好プロファイル）を作る。
 *    b. 未閲覧銘柄をタグ一致度でスコアリングし、上位 limit 件を返す（reason: history＋根拠）。
 *    c. スコア上位が limit に満たない場合は人気銘柄で補完する（ホームを常に埋める）。
 *
 * スコア計算そのものは scoring.ts の純関数に委ね、ここは DB アクセスと組み立てに徹する
 * （TEST_PHILOSOPHY: ロジックはユニット・DB は統合でテスト）。
 */

/** ルールベース推薦の機能固有パラメータ（DIRECTORY_STRUCTURE §5.3-5: 機能固有定数はここ）。 */
export type RuleBasedConfig = {
  /**
   * コールドスタート判定のしきい値（履歴イベント総数）。これ未満なら人気ランキングへ落とす
   * （DESIGN §2.5 初期値 3 件）。
   */
  coldStartThreshold: number;
  /**
   * 嗜好プロファイル作成に使う直近履歴の取得件数上限（閲覧・検索それぞれ）。
   * 古すぎる履歴は時間減衰でほぼ効かないため、集計対象を直近に絞ってクエリを軽くする。
   */
  recentHistoryLimit: number;
  /**
   * フォールバックで母集団とする人気銘柄の件数。この中から limit 件をランダムに選ぶことで
   * 毎回同じ並びにならない「ランダム性」を与える（DESIGN §2.5・§4.2）。
   */
  popularPoolSize: number;
  /** スコアリングの重み・減衰（scoring.ts の DEFAULT_WEIGHTS を上書きしたい場合に注入）。 */
  weights?: ScoringWeights;
};

export const DEFAULT_RULE_BASED_CONFIG: RuleBasedConfig = {
  coldStartThreshold: 3,
  recentHistoryLimit: 100,
  popularPoolSize: 30,
};

const POPULAR_REASON: RecommendReason = { kind: "popular" };

/** ミリ秒 → 日数（時間減衰の ageDays 算出用）。 */
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function ageDaysFrom(now: number, at: Date): number {
  return Math.max(0, (now - at.getTime()) / MS_PER_DAY);
}

/**
 * search_histories.filters（jsonb・DB を信頼しない unknown）から
 * 都道府県コード・タグ名を防御的に取り出す（DATABASE §2.7: SearchParams と同形）。
 * 形が壊れていても例外にせず「取れた分だけ」使う。
 */
function readFilterSignals(filters: unknown): {
  prefectureCode: string | null;
  tagNames: string[];
} {
  if (typeof filters !== "object" || filters === null) {
    return { prefectureCode: null, tagNames: [] };
  }
  const record = filters as Record<string, unknown>;
  const prefectureCode =
    typeof record.prefectureCode === "string" ? record.prefectureCode : null;
  const tagNames = Array.isArray(record.tagNames)
    ? record.tagNames.filter((t): t is string => typeof t === "string")
    : [];
  return { prefectureCode, tagNames };
}

/**
 * ユーザーの直近の閲覧・検索履歴を、嗜好プロファイル用のイベント列に集約する。
 *
 * - 閲覧: 履歴 1 行 = 1 イベント。その銘柄のタグ（sake_tags×tags）＋蔵元の都道府県を持つ。
 * - 検索: 履歴 1 行 = 1 イベント。filters の tagNames・prefectureCode を持つ。
 * viewed_at / searched_at から現在時刻との差（日数）を ageDays として付す。
 *
 * 返り値はイベント列（プロファイル化は scoring.ts）と、閲覧済み銘柄 ID の集合（除外用）。
 */
async function collectHistory(
  db: CatalogDb,
  userId: string,
  recentLimit: number,
  now: number,
): Promise<{ events: HistoryEvent[]; viewedSakeIds: Set<string> }> {
  const viewRows = await db
    .select({
      sakeId: viewHistories.sakeId,
      viewedAt: viewHistories.viewedAt,
      prefectureCode: breweries.prefectureCode,
    })
    .from(viewHistories)
    .innerJoin(sakes, eq(sakes.id, viewHistories.sakeId))
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(eq(viewHistories.userId, userId))
    .orderBy(desc(viewHistories.viewedAt), desc(viewHistories.id))
    .limit(recentLimit);

  const viewedSakeIds = new Set(viewRows.map((row) => row.sakeId));

  // 閲覧銘柄のタグを 1 クエリ一括取得（N+1 回避。selectTagsBySakeIds を再利用）。
  const tagsBySakeId = await selectTagsBySakeIds(db, [...viewedSakeIds]);

  const events: HistoryEvent[] = viewRows.map((row) => ({
    kind: "view",
    tagNames: (tagsBySakeId.get(row.sakeId) ?? []).map((t) => t.name),
    prefectureCode: row.prefectureCode,
    ageDays: ageDaysFrom(now, row.viewedAt),
  }));

  const searchRows = await db
    .select({
      filters: searchHistories.filters,
      searchedAt: searchHistories.searchedAt,
    })
    .from(searchHistories)
    .where(eq(searchHistories.userId, userId))
    .orderBy(desc(searchHistories.searchedAt), desc(searchHistories.id))
    .limit(recentLimit);

  for (const row of searchRows) {
    const { prefectureCode, tagNames } = readFilterSignals(row.filters);
    events.push({
      kind: "search",
      tagNames,
      prefectureCode,
      ageDays: ageDaysFrom(now, row.searchedAt),
    });
  }

  return { events, viewedSakeIds };
}

/**
 * 嗜好プロファイルに一致し得る候補銘柄を取得する。
 *
 * プロファイルにあるタグ名・都道府県コードのいずれかを持つ銘柄だけを SQL で絞り込み、
 * 全銘柄をメモリに載せない（数千件規模でも候補集合を小さく保つ）。閲覧済みは SQL で除外。
 * 返す候補には scoring 用のタグ名配列・都道府県を付ける（タグは一括取得）。
 */
async function selectCandidates(
  db: CatalogDb,
  profile: PreferenceProfile,
  viewedSakeIds: Set<string>,
): Promise<{
  candidates: ScoreCandidate[];
  summaries: Map<string, SakeSummary>;
}> {
  const tagNames = [...profile.tags.keys()];
  const prefectureCodes = [...profile.prefectures.keys()];

  const matchConditions = [];
  if (tagNames.length > 0) {
    // その銘柄がプロファイルのいずれかのタグを持つ（EXISTS 相関サブクエリ）。
    matchConditions.push(
      sql`exists (
        select 1 from ${sakeTags}
        inner join ${tags} on ${tags.id} = ${sakeTags.tagId}
        where ${sakeTags.sakeId} = ${sakes.id} and ${tags.name} in ${tagNames}
      )`,
    );
  }
  if (prefectureCodes.length > 0) {
    matchConditions.push(inArray(breweries.prefectureCode, prefectureCodes));
  }
  if (matchConditions.length === 0) {
    return { candidates: [], summaries: new Map() };
  }

  const rows = await db
    .select({
      id: sakes.id,
      name: sakes.name,
      breweryName: breweries.name,
      prefectureCode: breweries.prefectureCode,
    })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(
      and(
        or(...matchConditions),
        viewedSakeIds.size > 0
          ? sql`${sakes.id} not in ${[...viewedSakeIds]}`
          : undefined,
      ),
    )
    .orderBy(asc(sakes.name), asc(sakes.id));

  const tagsBySakeId = await selectTagsBySakeIds(
    db,
    rows.map((row) => row.id),
  );

  const candidates: ScoreCandidate[] = [];
  const summaries = new Map<string, SakeSummary>();
  for (const row of rows) {
    const tagList = tagsBySakeId.get(row.id) ?? [];
    candidates.push({
      sakeId: row.id,
      tagNames: tagList.map((t) => t.name),
      prefectureCode: row.prefectureCode,
    });
    summaries.set(row.id, {
      id: row.id,
      name: row.name,
      breweryName: row.breweryName,
      prefectureCode: row.prefectureCode,
      tags: tagList,
    });
  }
  return { candidates, summaries };
}

/**
 * 人気ランキング（popularity_rank）上位からランダムに limit 件返す（コールドスタート）。
 *
 * popularPoolSize 件の母集団を人気順で取り、そこから limit 件をシャッフルして選ぶことで
 * 毎回同じ並びにしない（DESIGN §2.5・§4.2 の「ランダム性」）。除外したい銘柄
 * （履歴ベースで既に選んだ銘柄）は excludeIds で外す。popularity_rank が NULL の銘柄は
 * 母集団に含めない（index 3 の部分インデックス対象）。
 */
async function selectPopular(
  db: CatalogDb,
  limit: number,
  poolSize: number,
  excludeIds: Set<string>,
): Promise<SakeSummary[]> {
  const rows = await db
    .select({
      id: sakes.id,
      name: sakes.name,
      breweryName: breweries.name,
      prefectureCode: breweries.prefectureCode,
    })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(
      excludeIds.size > 0
        ? and(
            isNotNull(sakes.popularityRank),
            sql`${sakes.id} not in ${[...excludeIds]}`,
          )
        : isNotNull(sakes.popularityRank),
    )
    .orderBy(asc(sakes.popularityRank))
    .limit(poolSize);

  const chosen = shuffle(rows).slice(0, limit);

  const tagsBySakeId = await selectTagsBySakeIds(
    db,
    chosen.map((row) => row.id),
  );

  return chosen.map((row) => ({
    id: row.id,
    name: row.name,
    breweryName: row.breweryName,
    prefectureCode: row.prefectureCode,
    tags: tagsBySakeId.get(row.id) ?? [],
  }));
}

/** Fisher-Yates シャッフル（元配列は破壊しない）。ランダム性は推薦の均し目的で暗号強度は不要。 */
function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * ルールベース推薦の本体（db を明示的に受ける下位関数）。
 * テストでは PGlite を差し込むためにこちらを直接呼ぶ。now も注入可能にして
 * 時間減衰を決定的にテストできるようにする。
 */
export async function recommendRuleBased(
  db: CatalogDb,
  input: { userId: string | null; limit: number },
  config: RuleBasedConfig = DEFAULT_RULE_BASED_CONFIG,
  now: number = Date.now(),
): Promise<RecommendedSake[]> {
  const { userId, limit } = input;
  if (limit <= 0) {
    return [];
  }

  // 未ログインは履歴を引けない → 人気ランキングのフォールバック（コールドスタート）。
  if (userId === null) {
    return fallbackOnly(db, limit, config);
  }

  const { events, viewedSakeIds } = await collectHistory(
    db,
    userId,
    config.recentHistoryLimit,
    now,
  );

  // 履歴イベント総数がしきい値未満 → フォールバック（DESIGN §2.5 コールドスタート）。
  if (events.length < config.coldStartThreshold) {
    return fallbackOnly(db, limit, config);
  }

  const profile = buildPreferenceProfile(events, config.weights);
  const { candidates, summaries } = await selectCandidates(
    db,
    profile,
    viewedSakeIds,
  );
  const scored = scoreCandidates(candidates, profile, viewedSakeIds).slice(
    0,
    limit,
  );

  const recommendations: RecommendedSake[] = [];
  for (const item of scored) {
    const sake = summaries.get(item.sakeId);
    if (sake) {
      recommendations.push({
        sake,
        reason: { kind: "history", signals: item.signals },
      });
    }
  }

  // スコア上位が limit に満たなければ人気銘柄で補完し、ホームを常に埋める。
  if (recommendations.length < limit) {
    const excludeIds = new Set([
      ...viewedSakeIds,
      ...recommendations.map((r) => r.sake.id),
    ]);
    const filler = await selectPopular(
      db,
      limit - recommendations.length,
      config.popularPoolSize,
      excludeIds,
    );
    for (const sake of filler) {
      recommendations.push({ sake, reason: POPULAR_REASON });
    }
  }

  return recommendations;
}

/** 人気ランキングのみで limit 件返す（未ログイン・コールドスタート共通）。 */
async function fallbackOnly(
  db: CatalogDb,
  limit: number,
  config: RuleBasedConfig,
): Promise<RecommendedSake[]> {
  const popular = await selectPopular(
    db,
    limit,
    config.popularPoolSize,
    new Set(),
  );
  return popular.map((sake) => ({ sake, reason: POPULAR_REASON }));
}
