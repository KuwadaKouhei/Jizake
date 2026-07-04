import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEIGHTS,
  buildPreferenceProfile,
  scoreCandidates,
  timeDecay,
  type HistoryEvent,
  type ScoreCandidate,
  type ScoringWeights,
} from "./scoring";

/**
 * 推薦スコアリングの純関数テスト（TEST_PHILOSOPHY: 推薦の正しさを厚くテスト）。
 * 嗜好集計・時間減衰・スコアリング・閲覧済み除外を DB 非依存で検証する。
 */

describe("timeDecay", () => {
  it("経過 0 日は 1（減衰なし）", () => {
    expect(timeDecay(0, 14)).toBe(1);
  });

  it("負の経過日数も 1 に丸める（未来日時の保険）", () => {
    expect(timeDecay(-5, 14)).toBe(1);
  });

  it("半減期ちょうどで 0.5 になる（指数減衰）", () => {
    expect(timeDecay(14, 14)).toBeCloseTo(0.5, 10);
  });

  it("半減期の 2 倍で 0.25 になる", () => {
    expect(timeDecay(28, 14)).toBeCloseTo(0.25, 10);
  });

  it("新しい履歴ほど重い（単調減少）", () => {
    expect(timeDecay(1, 14)).toBeGreaterThan(timeDecay(10, 14));
  });
});

describe("buildPreferenceProfile", () => {
  it("閲覧イベントが触れたタグ・都道府県に重みを加算する", () => {
    const events: HistoryEvent[] = [
      { kind: "view", tagNames: ["辛口"], prefectureCode: "35", ageDays: 0 },
    ];
    const profile = buildPreferenceProfile(events);
    expect(profile.tags.get("辛口")).toBeCloseTo(
      DEFAULT_WEIGHTS.viewWeight,
      10,
    );
    // 都道府県は prefectureMultiplier で弱める。
    expect(profile.prefectures.get("35")).toBeCloseTo(
      DEFAULT_WEIGHTS.viewWeight * DEFAULT_WEIGHTS.prefectureMultiplier,
      10,
    );
  });

  it("同じタグへの複数回のイベントで重みが積み上がる（頻度＝嗜好の強さ）", () => {
    const events: HistoryEvent[] = [
      { kind: "view", tagNames: ["辛口"], prefectureCode: null, ageDays: 0 },
      { kind: "view", tagNames: ["辛口"], prefectureCode: null, ageDays: 0 },
    ];
    const profile = buildPreferenceProfile(events);
    expect(profile.tags.get("辛口")).toBeCloseTo(
      DEFAULT_WEIGHTS.viewWeight * 2,
      10,
    );
  });

  it("新しい履歴が古い履歴より重く効く（時間減衰）", () => {
    const recent: HistoryEvent[] = [
      { kind: "view", tagNames: ["華やか"], prefectureCode: null, ageDays: 0 },
    ];
    const old: HistoryEvent[] = [
      { kind: "view", tagNames: ["華やか"], prefectureCode: null, ageDays: 28 },
    ];
    const recentProfile = buildPreferenceProfile(recent);
    const oldProfile = buildPreferenceProfile(old);
    expect(recentProfile.tags.get("華やか")!).toBeGreaterThan(
      oldProfile.tags.get("華やか")!,
    );
  });

  it("検索イベントは閲覧より軽い基礎重み", () => {
    const view = buildPreferenceProfile([
      { kind: "view", tagNames: ["淡麗"], prefectureCode: null, ageDays: 0 },
    ]);
    const search = buildPreferenceProfile([
      { kind: "search", tagNames: ["淡麗"], prefectureCode: null, ageDays: 0 },
    ]);
    expect(search.tags.get("淡麗")!).toBeLessThan(view.tags.get("淡麗")!);
  });

  it("重みは注入でき、都道府県倍率 0 なら県シグナルを作らない", () => {
    const weights: ScoringWeights = {
      halfLifeDays: 14,
      viewWeight: 1,
      searchWeight: 1,
      prefectureMultiplier: 0,
    };
    const profile = buildPreferenceProfile(
      [{ kind: "view", tagNames: ["辛口"], prefectureCode: "35", ageDays: 0 }],
      weights,
    );
    expect(profile.tags.get("辛口")).toBe(1);
    expect(profile.prefectures.get("35")).toBe(0);
  });
});

describe("scoreCandidates", () => {
  const profile = buildPreferenceProfile([
    { kind: "view", tagNames: ["辛口"], prefectureCode: "35", ageDays: 0 },
    {
      kind: "view",
      tagNames: ["辛口", "淡麗"],
      prefectureCode: "35",
      ageDays: 0,
    },
  ]);

  function candidate(
    sakeId: string,
    tagNames: string[],
    prefectureCode: string,
  ): ScoreCandidate {
    return { sakeId, tagNames, prefectureCode };
  }

  it("嗜好タグ一致度が高い銘柄を上位に返す", () => {
    const result = scoreCandidates(
      [
        candidate("a", ["辛口", "淡麗"], "35"), // タグ2つ＋県一致
        candidate("b", ["辛口"], "13"), // タグ1つのみ
        candidate("c", ["華やか"], "01"), // 一致なし
      ],
      profile,
      new Set(),
    );
    expect(result.map((r) => r.sakeId)).toEqual(["a", "b"]);
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("一致シグナルの無い銘柄（スコア 0）は除外する", () => {
    const result = scoreCandidates(
      [candidate("c", ["華やか"], "01")],
      profile,
      new Set(),
    );
    expect(result).toHaveLength(0);
  });

  it("閲覧済み銘柄は候補から除外する", () => {
    const result = scoreCandidates(
      [candidate("a", ["辛口", "淡麗"], "35"), candidate("b", ["辛口"], "35")],
      profile,
      new Set(["a"]),
    );
    expect(result.map((r) => r.sakeId)).toEqual(["b"]);
  });

  it("効いた根拠シグナルを寄与の大きい順に返す", () => {
    const result = scoreCandidates(
      [candidate("a", ["辛口", "淡麗"], "35")],
      profile,
      new Set(),
    );
    // 辛口は2イベント分・淡麗は1イベント分の重み。辛口が先頭に来る。
    const tagSignals = result[0].signals.filter((s) => s.type === "tag");
    expect(tagSignals[0]).toEqual({ type: "tag", label: "辛口" });
    // 県シグナルも含まれる。
    expect(result[0].signals).toContainEqual({
      type: "prefecture",
      code: "35",
    });
  });

  it("同点は sakeId 昇順で決定的に並ぶ", () => {
    const result = scoreCandidates(
      [candidate("z", ["辛口"], "13"), candidate("a", ["辛口"], "13")],
      profile,
      new Set(),
    );
    expect(result.map((r) => r.sakeId)).toEqual(["a", "z"]);
  });
});
