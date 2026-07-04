import { describe, expect, it } from "vitest";

import {
  aggregateMetrics,
  evaluateQuery,
  type QueryEvalResult,
} from "./metrics";

/**
 * 評価指標（recall@k / MRR / hit@k）の純関数テスト（TASKS T13②）。
 * DB・埋め込みに依存しないため、順位列と期待集合を直接与えて検証する。
 */

describe("evaluateQuery（1 質問の評価）", () => {
  it("最上位が期待銘柄なら hit・RR=1・recall は一致率", () => {
    const r = evaluateQuery(["a", "b", "c"], new Set(["a", "z"]), 3);
    expect(r.hit).toBe(true);
    expect(r.firstHitRank).toBe(1);
    expect(r.reciprocalRank).toBeCloseTo(1);
    // 期待 2 件のうち上位 3 に 1 件（a）→ recall 0.5
    expect(r.recall).toBeCloseTo(0.5);
  });

  it("2 番目でヒットなら RR=1/2", () => {
    const r = evaluateQuery(["x", "a", "b"], new Set(["a"]), 3);
    expect(r.firstHitRank).toBe(2);
    expect(r.reciprocalRank).toBeCloseTo(0.5);
    expect(r.recall).toBeCloseTo(1);
  });

  it("上位 k の外にあるヒットはカウントしない（recall@k・hit@k）", () => {
    // 期待 a は 4 位。k=3 なら圏外
    const r = evaluateQuery(["x", "y", "z", "a"], new Set(["a"]), 3);
    expect(r.hit).toBe(false);
    expect(r.firstHitRank).toBeNull();
    expect(r.reciprocalRank).toBe(0);
    expect(r.recall).toBe(0);
  });

  it("期待銘柄が複数上位に入れば recall が上がる", () => {
    const r = evaluateQuery(["a", "b", "c"], new Set(["a", "b"]), 3);
    expect(r.recall).toBeCloseTo(1);
    expect(r.firstHitRank).toBe(1);
  });

  it("期待集合が空・k<=0 は評価不能（全 0）", () => {
    expect(evaluateQuery(["a"], new Set(), 3)).toEqual({
      hit: false,
      recall: 0,
      reciprocalRank: 0,
      firstHitRank: null,
    });
    expect(evaluateQuery(["a"], new Set(["a"]), 0).hit).toBe(false);
  });
});

describe("aggregateMetrics（評価セット集計）", () => {
  it("平均 recall・MRR・hit 率を出す", () => {
    const results: QueryEvalResult[] = [
      { hit: true, recall: 1, reciprocalRank: 1, firstHitRank: 1 },
      { hit: true, recall: 0.5, reciprocalRank: 0.5, firstHitRank: 2 },
      { hit: false, recall: 0, reciprocalRank: 0, firstHitRank: null },
    ];
    const m = aggregateMetrics(results);
    expect(m.queryCount).toBe(3);
    expect(m.meanRecallAtK).toBeCloseTo((1 + 0.5 + 0) / 3);
    expect(m.mrr).toBeCloseTo((1 + 0.5 + 0) / 3);
    expect(m.hitRateAtK).toBeCloseTo(2 / 3);
  });

  it("空なら全 0（0 除算回避）", () => {
    expect(aggregateMetrics([])).toEqual({
      queryCount: 0,
      meanRecallAtK: 0,
      mrr: 0,
      hitRateAtK: 0,
    });
  });
});
