import { and, asc, cosineDistance, eq, exists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { embedText } from "@/lib/ai/embedding";
import { getDb } from "@/lib/db/client";
import {
  type CatalogDb,
  type SakeSummary,
  selectTagsBySakeIds,
} from "@/lib/db/queries/sakes";
import {
  breweries,
  sakeEmbeddings,
  sakeTags,
  sakes,
  tags,
} from "@/lib/db/schema";

/**
 * RAG リトリーバ（ハイブリッド検索）。**LLM に一切依存しない**（DESIGN §2.6）。
 *
 * generator（/api/chat の streamText）とは分離され、この層は
 *   タグ・都道府県・価格帯の SQL 絞り込み ＋ pgvector コサイン類似度
 * だけで候補を返す。LLM 非依存なので PGlite（+pgvector）で単体統合テストできる
 * （TEST_PHILOSOPHY: retriever は実 DB でテスト・生成部はモック）。
 *
 * 依存方向（DIRECTORY_STRUCTURE §5.2）: 機能ロジック層。共通カタログ
 * （src/lib/db/queries/sakes.ts の SakeSummary・selectTagsBySakeIds）と
 * 埋め込みアダプタ（src/lib/ai の embedText）にのみ依存し、UI の型は知らない。
 * 埋め込み関数は注入可能にし、テストではダミーのクエリベクトルを注入する（実 API を叩かない）。
 */

// ---------------------------------------------------------------------------
// ハイブリッド統合の重み・定数（マジックナンバー禁止。CODING_PHILOSOPHY スタイル）
// ---------------------------------------------------------------------------

/**
 * ベクタ類似度スコアの重み。自然文（freeText）がある場合の主シグナル。
 * 小規模 DB ではタグ SQL 絞り込みで母集団を絞った上での意味的近さが効くため高めにする
 * （FEASIBILITY R3: ハイブリッドはタグ SQL＋ベクタで精度が出る）。
 */
export const VECTOR_WEIGHT = 0.7;

/**
 * タグ一致度スコアの重み。要求タグのうち何割を持つかを 0..1 で評価する。
 * 埋め込みが無い銘柄（sake_embeddings 未登録）でもこの成分だけで順位が付き、
 * ベクタ検索に出ない銘柄をタグ検索で拾える設計を担保する。
 */
export const TAG_WEIGHT = 0.3;

/**
 * 返す候補の既定上限（DESIGN §6.3: プロンプトへ渡す候補は上位 8 件程度に絞る）。
 * generator へ渡すコンテキストとコストを抑えるため定数化する。
 */
export const DEFAULT_CANDIDATE_LIMIT = 8;

/**
 * 候補母集団の上限。ベクタ ORDER BY で上位を取得する件数の上限で、
 * タグ絞り込みが緩い（または無い）場合に全銘柄をメモリに載せないための保険
 * （汎用検索での自己 DoS 回避。REVIEW T10 PERF S-1 と同じ姿勢）。
 */
const CANDIDATE_POOL_SIZE = 100;

// リトリーバが受ける DB 型（本番は postgres-js、テストは PGlite を差し込む）。
type Db = CatalogDb;

// クエリ埋め込み関数の注入口。本番は embedText（実 API）、テストはダミーベクトルを注入する
// （TEST_PHILOSOPHY: 埋め込み API はテストで叩かない）。model は embedText の既定に委ねる。
export type EmbedQueryFn = (text: string) => Promise<number[]>;

/**
 * retriever の入力（DESIGN §5.3）。
 *
 * - freeText: ベクタ類似度に使う自然文（ユーザー発話・ヒアリング要約）。無指定ならベクタ成分なし。
 * - tagNames: 味タグ名の配列（SQL 絞り込み。複数は AND）。
 * - prefectureCode: 都道府県 JIS コード（蔵元 JOIN で絞る）。
 * - priceRange: 価格帯区分（sakes.price_range 一致）。
 * - limit: 返す候補数の上限（既定 DEFAULT_CANDIDATE_LIMIT）。
 */
export type RetrieveQuery = {
  freeText?: string;
  tagNames?: string[];
  prefectureCode?: string;
  priceRange?: string;
  limit?: number;
};

/**
 * 候補 1 件。SakeSummary（カード表示・詳細リンクに必要な実在 sakeId 付き）に、
 * ハイブリッドの統合スコアと根拠を添える。generator へ渡すのは実在 ID の候補のみ
 * （DESIGN §2.6 捏造防止の一段目: プロンプトに渡す候補は DB 実在 ID のみ）。
 */
export type SakeCandidate = {
  sake: SakeSummary;
  /** 統合スコア（大きいほど適合。VECTOR_WEIGHT・TAG_WEIGHT の加重和）。 */
  score: number;
  /** ベクタ類似度（0..1, 1 - cosine距離）。埋め込みが無い・freeText 無しなら null。 */
  vectorSimilarity: number | null;
  /** 要求タグのうち一致した数（根拠表示・デバッグ用）。 */
  matchedTagCount: number;
};

// ---------------------------------------------------------------------------
// スコア統合の純関数（DB 非依存・ユニットテスト対象）
// ---------------------------------------------------------------------------

/**
 * ベクタ類似度成分とタグ一致度成分を重み付き和で統合する（純関数）。
 *
 * - vectorSimilarity: 0..1。埋め込みが無い or freeText 無しのときは null（成分なし＝0 扱い）。
 * - matchedTagCount / requestedTagCount でタグ一致率（0..1）を出す。要求タグ 0 のときは
 *   タグ成分を評価に含めない（1 でも 0 でもなく「無関係」＝ 0 とし、ベクタのみで並べる）。
 *
 * requestedTagCount=0 かつ vectorSimilarity=null（＝タグも freeText も無い）の場合は
 * score=0 になり、呼び出し側の安定ソート（人気順→名前→id）で並ぶ。
 */
export function combineScore(input: {
  vectorSimilarity: number | null;
  matchedTagCount: number;
  requestedTagCount: number;
}): number {
  const vectorPart =
    input.vectorSimilarity === null
      ? 0
      : VECTOR_WEIGHT * input.vectorSimilarity;
  const tagRatio =
    input.requestedTagCount === 0
      ? 0
      : input.matchedTagCount / input.requestedTagCount;
  const tagPart = TAG_WEIGHT * tagRatio;
  return vectorPart + tagPart;
}

// ---------------------------------------------------------------------------
// SQL 絞り込み（タグ AND・都道府県・価格帯）— searchSakes と同型の EXISTS
// ---------------------------------------------------------------------------

/**
 * タグ・都道府県・価格帯のハード絞り込み条件を組み立てる。
 *
 * searchSakes（src/lib/db/queries/sakes.ts）の EXISTS/JOIN の考え方を踏襲する
 * （味タグは各タグの相関サブクエリ EXISTS を AND 連結）。retriever は freeText の
 * ベクタ順で並べる点が検索と異なるため、共通化せず同型のロジックを別に持つ
 * （Rule of Three: 現状 2 箇所。3 箇所目が出たら条件ビルダを昇格する）。
 */
function buildFilters(db: Db, query: RetrieveQuery) {
  const conditions = [];

  if (query.prefectureCode !== undefined) {
    conditions.push(eq(breweries.prefectureCode, query.prefectureCode));
  }
  if (query.priceRange !== undefined) {
    conditions.push(eq(sakes.priceRange, query.priceRange));
  }

  const tagNames = query.tagNames ?? [];
  for (const [i, tagName] of tagNames.entries()) {
    const st = alias(sakeTags, `rt_st_${i}`);
    const tg = alias(tags, `rt_tg_${i}`);
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(st)
          .innerJoin(tg, eq(tg.id, st.tagId))
          .where(and(eq(st.sakeId, sakes.id), eq(tg.name, tagName))),
      ),
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ---------------------------------------------------------------------------
// retriever 本体
// ---------------------------------------------------------------------------

/**
 * ハイブリッド検索の中核（db・埋め込み関数を明示的に受ける下位関数）。
 * テストでは PGlite とダミー埋め込みを差し込むためにこちらを直接呼ぶ。
 *
 * 手順:
 *   1. タグ・都道府県・価格帯で母集団を SQL 絞り込みする（EXISTS/JOIN）。
 *   2. freeText があればクエリを埋め込み、cosine 距離（<=> = cosineDistance）で
 *      近い順に上位 CANDIDATE_POOL_SIZE 件を取得する。埋め込みが無い銘柄も
 *      LEFT JOIN で母集団に残し（距離 null）、ベクタ検索に出ない銘柄をタグで拾う。
 *   3. freeText が無ければ人気順→名前順で母集団を取得する（ベクタ成分なし）。
 *   4. 各候補の統合スコア（combineScore）を計算し、降順（同点は人気→名前→id の
 *      安定順）で上位 limit 件を返す。タグは selectTagsBySakeIds で一括取得（N+1 回避）。
 *
 * 返す候補は必ず実在の sakeId を含む（DESIGN §2.6 捏造防止の一段目）。
 */
export async function retrieveSakeCandidates(
  db: Db,
  embedQuery: EmbedQueryFn,
  query: RetrieveQuery,
): Promise<SakeCandidate[]> {
  const limit = query.limit ?? DEFAULT_CANDIDATE_LIMIT;
  if (limit <= 0) {
    return [];
  }

  const where = buildFilters(db, query);
  const freeText = query.freeText?.trim();
  const hasFreeText = freeText !== undefined && freeText.length > 0;

  // ベクタ距離の式。freeText があれば埋め込んで cosineDistance を計算する。
  // 埋め込みが無い銘柄（LEFT JOIN で embedding が NULL）は距離 NULL になる。
  let distanceExpr = sql<number | null>`NULL::double precision`;
  if (hasFreeText) {
    const queryVector = await embedQuery(freeText);
    distanceExpr = sql<number | null>`
      CASE WHEN ${sakeEmbeddings.embedding} IS NULL THEN NULL
      ELSE ${cosineDistance(sakeEmbeddings.embedding, queryVector)} END
    `;
  }

  // 母集団の取得順序:
  // - freeText あり: 距離昇順（NULL は末尾）→ 人気順 → 名前 → id。近い銘柄を優先しつつ、
  //   埋め込み無し・非マッチ銘柄も pool 末尾に残す（タグで拾えるように）。
  // - freeText なし: 人気順（NULL 末尾）→ 名前 → id（純タグ絞り込みの安定順）。
  const orderBy = hasFreeText
    ? [
        sql`${distanceExpr} ASC NULLS LAST`,
        sql`${sakes.popularityRank} ASC NULLS LAST`,
        asc(sakes.name),
        asc(sakes.id),
      ]
    : [
        sql`${sakes.popularityRank} ASC NULLS LAST`,
        asc(sakes.name),
        asc(sakes.id),
      ];

  const rows = await db
    .select({
      id: sakes.id,
      name: sakes.name,
      breweryName: breweries.name,
      prefectureCode: breweries.prefectureCode,
      distance: distanceExpr,
    })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .leftJoin(sakeEmbeddings, eq(sakeEmbeddings.sakeId, sakes.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(CANDIDATE_POOL_SIZE);

  if (rows.length === 0) {
    return [];
  }

  const sakeIds = rows.map((row) => row.id);
  const tagsBySakeId = await selectTagsBySakeIds(db, sakeIds);

  const requestedTags = new Set(query.tagNames ?? []);
  const requestedTagCount = requestedTags.size;

  const candidates: SakeCandidate[] = rows.map((row) => {
    const tagSummaries = tagsBySakeId.get(row.id) ?? [];
    const matchedTagCount = tagSummaries.filter((tag) =>
      requestedTags.has(tag.name),
    ).length;

    // cosine 距離（0..2）を類似度（1..-1）へ。埋め込み無し・freeText 無しは null。
    const vectorSimilarity =
      row.distance === null ? null : 1 - Number(row.distance);

    return {
      sake: {
        id: row.id,
        name: row.name,
        breweryName: row.breweryName,
        prefectureCode: row.prefectureCode,
        tags: tagSummaries,
      },
      score: combineScore({
        vectorSimilarity,
        matchedTagCount,
        requestedTagCount,
      }),
      vectorSimilarity,
      matchedTagCount,
    };
  });

  // 統合スコア降順。同点は SQL 側の母集団順（距離→人気→名前→id）を保つため
  // 安定ソートに委ねる（Array.prototype.sort は V8 で安定）。
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

/**
 * ハイブリッド検索の公開エントリ（DESIGN §5.3: retrieveSakeCandidates）。
 *
 * 本番は本プロセスの DB クライアントと実 API 埋め込み（embedText）を使う。
 * テスト・PoC は下位の retrieveSakeCandidates(db, embedQuery, query) を直接呼び、
 * PGlite とダミー埋め込みを差し込む（実 API を叩かない）。
 */
export function retrieve(query: RetrieveQuery): Promise<SakeCandidate[]> {
  return retrieveSakeCandidates(getDb(), embedText, query);
}
