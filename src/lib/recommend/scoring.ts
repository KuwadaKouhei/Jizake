import type { RecommendSignal } from "./types";

/**
 * 推薦スコアリングの純関数（DESIGN §2.5 の初期実装＝ルールベース。TEST_PHILOSOPHY:
 * 推薦スコアリングを厚くユニットテストするため DB アクセスから分離する）。
 *
 * 責務は 2 段:
 * 1. 履歴イベント（閲覧・検索が触れたタグ・都道府県 ＋ どれくらい前か）→ 嗜好プロファイル
 *    （シグナルごとの時間減衰つき重み）。新しい履歴を重く扱う。
 * 2. 嗜好プロファイル ＋ 候補銘柄 → スコア。候補が持つタグ・都道府県のうちプロファイルに
 *    あるものの重みを合算する。閲覧済み銘柄は候補から除外する。
 *
 * ここは DB・UI を知らない純関数（DIRECTORY_STRUCTURE §5.2）。重み・減衰係数は
 * WEIGHTS 定数に集約し、テストや将来調整で注入できるよう関数引数でも受ける
 * （CODING_PHILOSOPHY: マジックナンバー禁止・重みは定数化）。
 */

/**
 * スコアリングの重み・減衰パラメータ（機能固有定数。DIRECTORY_STRUCTURE §5.3-5:
 * 機能固有の定数はその機能のディレクトリに置く＝constants をゴミ箱にしない）。
 *
 * 初期値は DESIGN §9「実装時に定数化し動作確認しながら調整」に従う暫定値。
 */
export type ScoringWeights = {
  /**
   * 時間減衰の半減期（日）。この日数だけ前の履歴は重み 1/2 になる（指数減衰）。
   * 線形でなく指数を選ぶ理由: 直近の嗜好を強く反映しつつ、古い履歴も 0 にはせず
   * 緩やかに効かせられる（線形は打ち切り日以前が一律 0 になり階段状に嗜好が飛ぶ）。
   */
  halfLifeDays: number;
  /** 閲覧イベントが 1 件生む基礎重み（減衰前）。 */
  viewWeight: number;
  /**
   * 検索イベントが 1 件生む基礎重み（減衰前）。検索は「探しに行った」能動的シグナルだが、
   * 1 回の検索で複数タグを AND 指定でき過大評価になりやすいため、閲覧よりやや軽くする。
   */
  searchWeight: number;
  /**
   * 都道府県（擬似タグ）シグナルの倍率。都道府県はタグより粒度が粗く数も少ないため、
   * 味タグと同格に扱うと産地だけで推薦が埋まりやすい。1 未満で弱める（DESIGN §3・D2:
   * 都道府県の擬似タグ扱いはロジック側に閉じる）。
   */
  prefectureMultiplier: number;
};

/** 初期の重み・減衰（DESIGN §9 の暫定値。動作確認しながら調整可能）。 */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  halfLifeDays: 14,
  viewWeight: 1,
  searchWeight: 0.7,
  prefectureMultiplier: 0.6,
};

/** 履歴 1 イベントが触れたシグナル（タグ名 or 都道府県コード）と、その古さ。 */
export type HistoryEvent = {
  kind: "view" | "search";
  /** イベントが触れたタグ名（味・種別を問わない）。重複可（呼び出し側で束ねない）。 */
  tagNames: string[];
  /** イベントが触れた都道府県コード（閲覧銘柄の蔵元県・検索の県条件）。無ければ null。 */
  prefectureCode: string | null;
  /** 現在時刻からの経過日数（>= 0）。新しいほど 0 に近い。 */
  ageDays: number;
};

/** 嗜好プロファイル: シグナルごとの累積重み（大きいほど強い嗜好）。 */
export type PreferenceProfile = {
  /** タグ名 → 重み。 */
  tags: Map<string, number>;
  /** 都道府県コード → 重み。 */
  prefectures: Map<string, number>;
};

/** 指数的な時間減衰係数（0..1）。ageDays=0 で 1、halfLifeDays で 0.5。 */
export function timeDecay(ageDays: number, halfLifeDays: number): number {
  if (ageDays <= 0) {
    return 1;
  }
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function addWeight(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

/**
 * 履歴イベント列 → 嗜好プロファイル（時間減衰つき頻度集計）。
 *
 * 各イベントの基礎重み（view/search）に時間減衰を掛け、触れたタグ・都道府県へ加算する。
 * 同じタグに複数回触れれば重みが積み上がる（頻度が嗜好の強さになる）。
 */
export function buildPreferenceProfile(
  events: HistoryEvent[],
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): PreferenceProfile {
  const tags = new Map<string, number>();
  const prefectures = new Map<string, number>();

  for (const event of events) {
    const base =
      event.kind === "view" ? weights.viewWeight : weights.searchWeight;
    const decayed = base * timeDecay(event.ageDays, weights.halfLifeDays);
    if (decayed <= 0) {
      continue;
    }
    for (const tagName of event.tagNames) {
      addWeight(tags, tagName, decayed);
    }
    if (event.prefectureCode !== null) {
      addWeight(
        prefectures,
        event.prefectureCode,
        decayed * weights.prefectureMultiplier,
      );
    }
  }

  return { tags, prefectures };
}

/**
 * プロファイルのタグを重み降順で上位 maxTags 件に絞る（純関数）。
 *
 * 汎用タグ（辛口・純米等）を大量に持つヘビーユーザーでは profile.tags が肥大化し、候補取得 SQL の
 * `IN (...)` サイズが膨らむ（REVIEW T10 PERF/SEC S-1）。プロファイルは「効く上位シグナルだけ」で
 * 十分近似できるため、IN に渡す前に重み上位 K 件へ truncate する。都道府県は元々件数が少ないため
 * 絞らない。同点は tagName 昇順で決定的にする（テスト・SQL の再現性）。
 */
export function truncateProfileTags(
  profile: PreferenceProfile,
  maxTags: number,
): PreferenceProfile {
  if (maxTags <= 0) {
    return { tags: new Map(), prefectures: profile.prefectures };
  }
  if (profile.tags.size <= maxTags) {
    return profile;
  }
  const top = [...profile.tags.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .slice(0, maxTags);
  return { tags: new Map(top), prefectures: profile.prefectures };
}

/** スコア対象の候補銘柄（プロファイルとの一致度だけを見るため最小限の属性）。 */
export type ScoreCandidate = {
  sakeId: string;
  tagNames: string[];
  prefectureCode: string;
};

/** スコアリング結果（銘柄 ID・合計スコア・効いた根拠シグナル）。 */
export type ScoredCandidate = {
  sakeId: string;
  score: number;
  signals: RecommendSignal[];
};

/**
 * 候補銘柄をプロファイルでスコアリングし、閲覧済みを除外して降順に返す（純関数）。
 *
 * スコア = 候補が持つタグ・都道府県のうちプロファイルにあるものの重みの合計。
 * 閲覧済み銘柄（viewedSakeIds）は「除外」する（減点ではなく除外を選ぶ理由: 既に見た銘柄を
 * 再提示しても発見価値がなく、ホームは新規発見の面。履歴自体は /history で参照できる）。
 * スコア 0（プロファイルと一致なし）の候補も落とす。
 *
 * signals は寄与の大きい順に整列し、UI が「効いた理由」を安定して表示できるようにする。
 * 並びは score 降順→同点は sakeId 昇順で決定的にする（テスト・表示の再現性）。
 */
export function scoreCandidates(
  candidates: ScoreCandidate[],
  profile: PreferenceProfile,
  viewedSakeIds: ReadonlySet<string>,
): ScoredCandidate[] {
  const scored: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    if (viewedSakeIds.has(candidate.sakeId)) {
      continue;
    }

    let score = 0;
    const contributions: { signal: RecommendSignal; weight: number }[] = [];

    for (const tagName of candidate.tagNames) {
      const weight = profile.tags.get(tagName);
      if (weight !== undefined && weight > 0) {
        score += weight;
        contributions.push({
          signal: { type: "tag", label: tagName },
          weight,
        });
      }
    }

    const prefWeight = profile.prefectures.get(candidate.prefectureCode);
    if (prefWeight !== undefined && prefWeight > 0) {
      score += prefWeight;
      contributions.push({
        signal: { type: "prefecture", code: candidate.prefectureCode },
        weight: prefWeight,
      });
    }

    if (score <= 0) {
      continue;
    }

    contributions.sort((a, b) => b.weight - a.weight);
    scored.push({
      sakeId: candidate.sakeId,
      score,
      signals: contributions.map((c) => c.signal),
    });
  }

  scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.sakeId < b.sakeId ? -1 : 1,
  );
  return scored;
}
