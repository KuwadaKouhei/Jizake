/**
 * RAG 精度 PoC の評価指標（純関数。TASKS T13②）。
 *
 * retriever が返した候補（順位つき）と「期待銘柄 ID 集合」を突き合わせ、
 * recall@k / MRR / hit@k を計算する。DB・LLM・埋め込みには一切依存しない純関数なので
 * ユニットテストできる（TEST_PHILOSOPHY）。retriever 本体（src/lib/rag）は変えない。
 *
 * 配置（DIRECTORY_STRUCTURE §3・DIR-7）: 評価ハーネスは使い捨ての PoC 資産であり
 * Web アプリのビルド対象に含めないため scripts/lib 配下に置く（本番バンドルに入れない）。
 * ロジックはここに集約してテスト可能にする（指示⑤）。
 */

/** 1 件の評価結果（1 質問に対する retriever の当たり具合）。 */
export type QueryEvalResult = {
  /** 期待銘柄のうち上位 k 件に少なくとも 1 件が含まれたか（hit@k）。 */
  hit: boolean;
  /** 上位 k 件に含まれた期待銘柄の数 ÷ 期待銘柄総数（recall@k、0..1）。 */
  recall: number;
  /**
   * 最初にヒットした期待銘柄の逆順位（1/rank）。上位に無ければ 0。
   * MRR の 1 質問ぶんの寄与（Reciprocal Rank）。
   */
  reciprocalRank: number;
  /** 最初にヒットした期待銘柄の順位（1 始まり）。無ければ null。 */
  firstHitRank: number | null;
};

/**
 * 1 質問の評価。retriever が返した候補 ID（順位順、0 番目が最上位）と
 * 期待銘柄 ID 集合から recall@k / RR / hit@k を計算する。
 *
 * - k は評価する上位件数（例: 5）。ranked が k 件未満なら全件で評価する。
 * - expectedIds が空なら評価不能として recall=0・RR=0・hit=false を返す
 *   （呼び出し側が評価セットで空を作らない前提だが防御的に定義）。
 * - ranked 内の重複 ID は最初の出現順位で扱う（呼び出し側で畳んでおくのが望ましい）。
 */
export function evaluateQuery(
  rankedIds: readonly string[],
  expectedIds: ReadonlySet<string>,
  k: number,
): QueryEvalResult {
  if (expectedIds.size === 0 || k <= 0) {
    return { hit: false, recall: 0, reciprocalRank: 0, firstHitRank: null };
  }

  const topK = rankedIds.slice(0, k);
  const matchedInTopK = new Set<string>();
  let firstHitRank: number | null = null;

  for (let i = 0; i < topK.length; i++) {
    const id = topK[i];
    if (expectedIds.has(id)) {
      matchedInTopK.add(id);
      if (firstHitRank === null) {
        firstHitRank = i + 1; // 1 始まりの順位
      }
    }
  }

  const recall = matchedInTopK.size / expectedIds.size;
  const reciprocalRank = firstHitRank === null ? 0 : 1 / firstHitRank;

  return {
    hit: matchedInTopK.size > 0,
    recall,
    reciprocalRank,
    firstHitRank,
  };
}

/** 評価セット全体の集計指標。 */
export type AggregateMetrics = {
  /** 評価した質問数。 */
  queryCount: number;
  /** 平均 recall@k（0..1）。 */
  meanRecallAtK: number;
  /** Mean Reciprocal Rank（0..1）。 */
  mrr: number;
  /** hit@k した質問の割合（0..1）。 */
  hitRateAtK: number;
};

/**
 * 各質問の評価結果を集計する純関数。
 * queryCount が 0 のときは全指標 0（0 除算回避）。
 */
export function aggregateMetrics(
  results: readonly QueryEvalResult[],
): AggregateMetrics {
  const queryCount = results.length;
  if (queryCount === 0) {
    return { queryCount: 0, meanRecallAtK: 0, mrr: 0, hitRateAtK: 0 };
  }

  let recallSum = 0;
  let rrSum = 0;
  let hitCount = 0;
  for (const r of results) {
    recallSum += r.recall;
    rrSum += r.reciprocalRank;
    if (r.hit) {
      hitCount += 1;
    }
  }

  return {
    queryCount,
    meanRecallAtK: recallSum / queryCount,
    mrr: rrSum / queryCount,
    hitRateAtK: hitCount / queryCount,
  };
}
