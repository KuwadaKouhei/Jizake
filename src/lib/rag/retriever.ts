import {
  and,
  asc,
  cosineDistance,
  eq,
  inArray,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";

import { embedText } from "@/lib/ai/embedding";
import { getDb } from "@/lib/db/client";
import {
  buildTagAndFilters,
  type CatalogDb,
  type SakeSummary,
  selectTagsBySakeIds,
} from "@/lib/db/queries/sakes";
import {
  breweries,
  sakeEmbeddings,
  sakes,
  sakeTags,
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
 * 候補母集団の上限。各経路（ANN・タグ）で取得する件数の上限で、
 * タグ絞り込みが緩い（または無い）場合に全銘柄をメモリに載せないための保険
 * （汎用検索での自己 DoS 回避。REVIEW T10 PERF S-1 と同じ姿勢）。
 *
 * T13 で B-1（HNSW を活かすクエリ形状）を実装し、候補集合の作り方を
 * 「ANN 経路（sake_embeddings 起点の素の `<=>` ORDER BY LIMIT）とタグ経路
 * （タグ/都道府県/価格帯の SQL 絞り込み）の和集合」に変更した。ANN 経路は HNSW
 * インデックスが効く形状で近傍上位を取り、タグ経路は埋め込みが無い銘柄も母集団に残す。
 * どちらも本定数で件数を頭打ちにする（REVIEW T12 PERF B-1 の移管対応）。
 */
const CANDIDATE_POOL_SIZE = 100;

/**
 * freeText の最大長。巨大テキストをそのまま埋め込みに渡すコスト・API エラーを避けるため、
 * 埋め込み前に切り詰める（信頼境界外の入力への防御。REVIEW T12 SEC S-2）。
 */
const MAX_FREE_TEXT_LENGTH = 1000;

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
  /**
   * ベクタ類似度（0..1）。`max(0, 1 - cosine距離)` で下限 0 にクランプ済み
   * （逆向き＝負の意味的類似は「無関係」= 0 に丸め、順位逆転を防ぐ。REVIEW T12 CODE S-1）。
   * 埋め込みが無い・freeText 無しなら null。
   */
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
 * - vectorSimilarity: 0..1（呼び出し側が max(0, 1 - cosine距離) でクランプ済み）。埋め込みが
 *   無い or freeText 無しのときは null（成分なし＝0 扱い）。負値を渡さない前提（範囲は
 *   呼び出し側が保証）。
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
 * 味タグの AND 絞り込みは searchSakes（検索）と同型のため共通ヘルパ buildTagAndFilters
 * （src/lib/db/queries/sakes.ts）を使い、両者の挙動を一致させる（Rule of Three 昇格。
 * alias 接頭辞 "rt" で searchSakes の "st" と分ける）。retriever 固有の並び（freeText の
 * ベクタ順）は本体の orderBy 側に持つ。
 */
function buildFilters(db: Db, query: RetrieveQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.prefectureCode !== undefined) {
    conditions.push(eq(breweries.prefectureCode, query.prefectureCode));
  }
  if (query.priceRange !== undefined) {
    conditions.push(eq(sakes.priceRange, query.priceRange));
  }
  conditions.push(...buildTagAndFilters(db, query.tagNames ?? [], "rt"));

  return conditions.length > 0 ? and(...conditions) : undefined;
}

// ---------------------------------------------------------------------------
// retriever 本体
// ---------------------------------------------------------------------------

/**
 * ANN 経路: sake_embeddings を起点に、クエリベクトルへの cosine 距離（<=>）で
 * 近い順に上位 CANDIDATE_POOL_SIZE 件の sakeId を取る（B-1: HNSW を活かす形状）。
 *
 * `sake_embeddings.embedding <=> $query` の素の ORDER BY LIMIT にすることで
 * HNSW インデックス（`vector_cosine_ops`, DATABASE §3 index 10）を近傍探索に
 * 使わせる（CASE 式・LEFT JOIN・複合 ORDER BY を挟むと index が効かない。REVIEW T12 B-1）。
 *
 * タグ/都道府県/価格帯のハード絞り込み（where）はここでも AND する。距離の
 * ORDER BY を維持したまま同じフィルタで絞れば HNSW の候補走査に絞り込みが乗る
 * （プランナが index 併用可）。ここで返らなかった銘柄（埋め込み無し等）はタグ経路が拾う。
 *
 * 返すのは距離つきの sakeId のみ（詳細・タグは呼び出し側で ID 集合に対しまとめて引く）。
 */
async function selectAnnCandidates(
  db: Db,
  queryVector: number[],
  where: SQL | undefined,
): Promise<{ id: string; distance: number }[]> {
  // cosineDistance の戻り型は unknown 相当のため number として扱う（下で Number 化する）。
  const distance = sql<number>`${cosineDistance(sakeEmbeddings.embedding, queryVector)}`;
  return (
    db
      .select({ id: sakeEmbeddings.sakeId, distance })
      .from(sakeEmbeddings)
      .innerJoin(sakes, eq(sakes.id, sakeEmbeddings.sakeId))
      .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
      .where(where)
      // 素の距離 ORDER BY LIMIT（HNSW 近傍探索が効く形状）。
      .orderBy(asc(distance))
      .limit(CANDIDATE_POOL_SIZE)
  );
}

/**
 * タグ経路: タグ/都道府県/価格帯のハード絞り込みで母集団の sakeId を取る。
 *
 * 埋め込みの有無に依存しない（sake_embeddings を JOIN しない）ので、ベクタ検索に
 * 出ない銘柄（埋め込み未登録）も母集団に残せる（DESIGN §2.6・タグで拾う担保）。
 * 人気順→名前→id の安定順で上位 CANDIDATE_POOL_SIZE 件。
 */
async function selectTagCandidates(
  db: Db,
  where: SQL | undefined,
): Promise<string[]> {
  const rows = await db
    .select({ id: sakes.id })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(where)
    .orderBy(
      sql`${sakes.popularityRank} ASC NULLS LAST`,
      asc(sakes.name),
      asc(sakes.id),
    )
    .limit(CANDIDATE_POOL_SIZE);
  return rows.map((row) => row.id);
}

/**
 * 候補 sakeId 集合に対して、カード表示に必要な銘柄要約（＋人気順の安定ソート用の
 * popularityRank・name）を一括取得する。ID の集合検索なので N+1 にならない。
 */
async function loadCandidateSakes(
  db: Db,
  ids: readonly string[],
): Promise<
  Map<
    string,
    {
      name: string;
      breweryName: string;
      prefectureCode: string;
      imageUrl: string | null;
      popularityRank: number | null;
    }
  >
> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      id: sakes.id,
      name: sakes.name,
      breweryName: breweries.name,
      prefectureCode: breweries.prefectureCode,
      imageUrl: sakes.imageUrl,
      popularityRank: sakes.popularityRank,
    })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(inArray(sakes.id, [...ids]));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        name: row.name,
        breweryName: row.breweryName,
        prefectureCode: row.prefectureCode,
        imageUrl: row.imageUrl,
        popularityRank: row.popularityRank,
      },
    ]),
  );
}

/**
 * ハイブリッド検索の中核（db・埋め込み関数を明示的に受ける下位関数）。
 * テストでは PGlite とダミー埋め込みを差し込むためにこちらを直接呼ぶ。
 *
 * 手順（B-1: ANN 経路とタグ経路の分離。REVIEW T12 PERF B-1 の移管対応）:
 *   1. タグ・都道府県・価格帯のハード絞り込み条件（where）を組み立てる。
 *   2. freeText があればクエリを埋め込み、**ANN 経路**（selectAnnCandidates）で
 *      HNSW を活かす素の `<=>` ORDER BY LIMIT により近傍上位の sakeId＋距離を取る。
 *   3. **タグ経路**（selectTagCandidates）で同じ where により sakeId を取る。埋め込みが
 *      無い銘柄もここで母集団に残る（ベクタ検索に出ない銘柄をタグで拾う）。
 *   4. 両経路の sakeId を和集合にし、その集合の銘柄要約・タグを一括取得（N+1 回避）。
 *      ANN 経路の距離をベクタ類似度成分にし、統合スコア（combineScore）を計算する。
 *   5. スコア降順（同点は距離→人気→名前→id の安定順）で上位 limit 件を返す。
 *
 * ハード絞り込み条件（タグ・都道府県・価格帯）が無く freeText だけのとき（＝純粋な
 * 意味検索）は、タグ経路が返す人気順の母集団は上位スコアに寄与しないため取得を省く
 * （母集団を最大 pool×2 → pool に半減。REVIEW T13 PERF S-2）。この場合、埋め込みが無い
 * 銘柄は候補に入らない（絞り込む理由が無い意味検索では埋め込み有り銘柄のみを返す）。
 *
 * 上位 limit 件は距離で決まり分離前と等価。候補が limit 件に満たない場合の下位の顔ぶれは、
 * 母集団の取り方（和集合／ANN のみ）により分離前と変わり得る（RAG_POC.md §8.3）。
 * 公開シグネチャ retrieve(query) と戻り値 SakeCandidate[] は不変（REVIEW T12 B-1 の制約）。
 * 返す候補は必ず実在の sakeId を含む（DESIGN §2.6 捏造防止の一段目）。
 */
export async function retrieveSakeCandidates(
  db: Db,
  embedQuery: EmbedQueryFn,
  query: RetrieveQuery,
): Promise<SakeCandidate[]> {
  // 上位層が過大な limit を渡しても母集団上限を超えないようクランプする（値渡しミス耐性。
  // REVIEW T12 SEC S-3）。0 以下は候補なし（埋め込みも呼ばない）。
  const requestedLimit = query.limit ?? DEFAULT_CANDIDATE_LIMIT;
  const limit = Math.min(requestedLimit, CANDIDATE_POOL_SIZE);
  if (limit <= 0) {
    return [];
  }

  const where = buildFilters(db, query);
  // 巨大テキストは埋め込み前に切り詰める（コスト・API エラー回避。REVIEW T12 SEC S-2）。
  const freeText = query.freeText?.trim().slice(0, MAX_FREE_TEXT_LENGTH);
  const hasFreeText = freeText !== undefined && freeText.length > 0;

  // ANN 経路: freeText があるときだけクエリを埋め込み、近傍上位＋距離を取る。
  // 距離は sakeId → distance のマップにして後段のスコア計算で引く。
  const distanceById = new Map<string, number>();
  if (hasFreeText) {
    const queryVector = await embedQuery(freeText);
    const annRows = await selectAnnCandidates(db, queryVector, where);
    for (const row of annRows) {
      distanceById.set(row.id, Number(row.distance));
    }
  }

  // タグ経路: 埋め込みの有無に依存せず母集団を取る（埋め込み無し銘柄もここで残る）。
  // ただしハード絞り込みが無く freeText のみ（純粋な意味検索）のときは、タグ経路の
  // 人気順母集団が上位に寄与しないため取得を省く（母集団を半減。REVIEW T13 PERF S-2）。
  const skipTagPath = where === undefined && hasFreeText;
  const tagIds = skipTagPath ? [] : await selectTagCandidates(db, where);

  // 両経路の和集合（順序は問わない。最終順位はスコアで決める）。
  const idSet = new Set<string>([...distanceById.keys(), ...tagIds]);
  if (idSet.size === 0) {
    return [];
  }
  const ids = [...idSet];

  const [sakeById, tagsBySakeId] = await Promise.all([
    loadCandidateSakes(db, ids),
    selectTagsBySakeIds(db, ids),
  ]);

  const requestedTags = new Set(query.tagNames ?? []);
  const requestedTagCount = requestedTags.size;

  const scored: ScoredCandidate[] = [];
  for (const id of ids) {
    const sake = sakeById.get(id);
    // 和集合の ID は直前に取得したもので必ず存在するが、型の健全性のため防御的に飛ばす。
    if (sake === undefined) {
      continue;
    }
    const tagSummaries = tagsBySakeId.get(id) ?? [];
    const matchedTagCount = tagSummaries.filter((tag) =>
      requestedTags.has(tag.name),
    ).length;

    // cosine 距離（0..2）を類似度へ。1 - 距離は 1..-1 になり得るが、負（逆向き＝無関係）は
    // 0 にクランプする。クランプしないとタグ同一一致でも「埋め込み有り（逆向き）」が
    // 「埋め込み無し（null=0 扱い）」より下に沈み順位が逆転する（REVIEW T12 CODE S-1）。
    const distance = distanceById.get(id);
    const vectorSimilarity =
      distance === undefined ? null : Math.max(0, 1 - distance);

    scored.push({
      candidate: {
        sake: {
          id,
          name: sake.name,
          breweryName: sake.breweryName,
          prefectureCode: sake.prefectureCode,
          imageUrl: sake.imageUrl,
          tags: tagSummaries,
        },
        score: combineScore({
          vectorSimilarity,
          matchedTagCount,
          requestedTagCount,
        }),
        vectorSimilarity,
        matchedTagCount,
      },
      // 安定ソート用の従属キー（公開型 SakeCandidate には含めない）。
      distance: distance ?? Number.POSITIVE_INFINITY,
      popularityRank: sake.popularityRank,
      name: sake.name,
      id,
    });
  }

  // 統合スコア降順。同点は分離前と同じ順（距離昇順→人気昇順→名前→id）で決める
  // （母集団を SQL の 1 本の ORDER BY で並べていた挙動を、和集合化に伴い明示比較に移す）。
  scored.sort(compareScored);
  return scored.slice(0, limit).map((s) => s.candidate);
}

// ---------------------------------------------------------------------------
// 最終順位付け（和集合化に伴い、分離前の複合 ORDER BY 相当をメモリ比較で再現）
// ---------------------------------------------------------------------------

/** スコア済み候補＋安定ソート用の従属キー（返り値の型には含めない内部表現）。 */
type ScoredCandidate = {
  candidate: SakeCandidate;
  /** ANN 経路の距離（無ければ +Infinity＝末尾）。 */
  distance: number;
  popularityRank: number | null;
  name: string;
  id: string;
};

/**
 * 候補の最終順位比較。スコア降順を主キーに、同点は距離昇順→人気昇順〔NULL 末尾〕→
 * 名前→id で決める。ANN 経路に無い銘柄の距離は +Infinity（末尾）、人気 NULL も末尾。
 * 最終的に id（UUID）で必ず決着するため決定的。名前比較は表示上の安定性のための補助で、
 * JS の localeCompare("ja") は Postgres の列照合順と厳密には一致しない（REVIEW T13 CODE S-1）。
 */
function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.candidate.score !== a.candidate.score) {
    return b.candidate.score - a.candidate.score;
  }
  if (a.distance !== b.distance) {
    return a.distance - b.distance;
  }
  const ra = a.popularityRank ?? Number.POSITIVE_INFINITY;
  const rb = b.popularityRank ?? Number.POSITIVE_INFINITY;
  if (ra !== rb) {
    return ra - rb;
  }
  const byName = a.name.localeCompare(b.name, "ja");
  if (byName !== 0) {
    return byName;
  }
  return a.id.localeCompare(b.id);
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

// ---------------------------------------------------------------------------
// 絞り込み状況の要約（該当件数＋実在する次の絞り込み候補）— T23
// ---------------------------------------------------------------------------

/** 次の絞り込み候補として返す味タグの上限（LLM への選択肢提示に十分な数）。 */
export const NARROWING_TAG_LIMIT = 8;

/**
 * ハード絞り込み条件の要約。チャットの段階的ヒアリング（T23）で
 * 「その条件だと何件か」「その中でさらに絞れる実在の選択肢は何か」を LLM に渡す。
 */
export type RetrieveFilterSummary = {
  /** ハード絞り込み（タグ AND・都道府県・価格帯）に一致する銘柄の総数。 */
  total: number;
  /**
   * 一致集合の中で実際に付いている味タグと件数（要求済みタグは除く・件数降順）。
   * LLM はこの中からだけ次の絞り込み質問の選択肢を作る（存在しない条件で絞って
   * 0 件に落ちる会話を防ぐ）。
   */
  narrowingTags: { name: string; count: number }[];
};

/**
 * ハード絞り込み条件（freeText を除くタグ・都道府県・価格帯）に一致する銘柄の
 * 総数と、その集合内の味タグ分布（ファセット）を返す（db を受けるテスト可能な下位関数）。
 *
 * retrieveSakeCandidates と同じ buildFilters を使い、検索と件数の判定を一致させる。
 * ベクタ検索（freeText）はソフトな並べ替えであり件数を変えないため、ここでは扱わない。
 */
export async function summarizeFilterFacets(
  db: Db,
  query: Pick<RetrieveQuery, "tagNames" | "prefectureCode" | "priceRange">,
): Promise<RetrieveFilterSummary> {
  const where = buildFilters(db, query);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(where);

  const requested = query.tagNames ?? [];
  const facetCount = sql<number>`count(distinct ${sakeTags.sakeId})::int`;
  const facetConditions: SQL[] = [eq(tags.category, "taste")];
  if (requested.length > 0) {
    facetConditions.push(notInArray(tags.name, requested));
  }

  const narrowingTags = await db
    .select({ name: tags.name, count: facetCount })
    .from(sakeTags)
    .innerJoin(tags, eq(tags.id, sakeTags.tagId))
    .innerJoin(sakes, eq(sakes.id, sakeTags.sakeId))
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(and(where, ...facetConditions))
    .groupBy(tags.name)
    .orderBy(sql`count(distinct ${sakeTags.sakeId}) desc`, asc(tags.name))
    .limit(NARROWING_TAG_LIMIT);

  return { total, narrowingTags };
}

/** 絞り込み要約の公開エントリ（本番 DB 使用。テストは summarizeFilterFacets を直接呼ぶ）。 */
export function summarizeFilters(
  query: Pick<RetrieveQuery, "tagNames" | "prefectureCode" | "priceRange">,
): Promise<RetrieveFilterSummary> {
  return summarizeFilterFacets(getDb(), query);
}
