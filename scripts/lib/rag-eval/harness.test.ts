import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import { SEED_SAKES } from "../../../seed-data/sakes";
import { seedSakes } from "../../seed";
import { EVAL_CASES } from "./eval-set";
import { fakeEmbedText } from "./fake-embedding";
import { runEval } from "./harness";

/**
 * 評価ハーネスの統合テスト（TASKS T13②）＋評価セットと seed-data の整合検証（T13①）。
 *
 * 実 seed-data（seed-data/sakes.ts）を PGlite に投入し、決定的ダミー埋め込みで評価ハーネスを
 * 走らせる。**精度の絶対値は検証しない**（ダミー埋め込みでは無意味）。担保するのは:
 *   - ハーネスが end-to-end で動き、指標（recall@k/MRR/hit@k）が計算されて範囲内に収まる
 *   - 評価セットの期待銘柄名がすべて seed-data に実在する（typo・未投入が無い＝評価の前提）
 * 実埋め込みでの精度実測は実キー投入後の作業（docs/RAG_POC.md の残作業）。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await migrate(orm, { migrationsFolder: "drizzle" });
  // 実 seed-data を投入（評価は実在銘柄名で期待を表現し、ここで実 ID に解決される）
  await seedSakes(orm, SEED_SAKES);
  // 全銘柄に決定的ダミー埋め込みを投入する。実運用（npm run embed）では全銘柄に埋め込みが
  // 付く前提で、純粋な意味検索（freeText のみ）は ANN 経路で候補を返す。埋め込みが無いと
  // フィルタ無し freeText 検索は候補 0 件になる（PERF S-2 でタグ経路を省くため）。
  const sakes = await orm
    .select({ id: schema.sakes.id, name: schema.sakes.name })
    .from(schema.sakes);
  await orm.insert(schema.sakeEmbeddings).values(
    sakes.map((s) => ({
      sakeId: s.id,
      embedding: fakeEmbedText(s.name),
      model: "fake/eval",
      sourceHash: s.id,
    })),
  );
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("評価セットと seed-data の整合（T13①）", () => {
  it("評価セットの期待銘柄名はすべて seed-data に実在する（typo・未投入なし）", async () => {
    const report = await runEval(
      orm,
      async (t) => fakeEmbedText(t),
      EVAL_CASES,
    );
    // 解決できない期待銘柄名があれば評価の前提が崩れる（seed-data と厳密一致を要求）
    expect(report.unresolvedExpectedNames).toEqual([]);
  });

  it("評価セットは 10 パターンで、各質問に期待銘柄が 1 件以上ある", () => {
    expect(EVAL_CASES).toHaveLength(10);
    for (const c of EVAL_CASES) {
      expect(c.expectedSakeNames.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("評価ハーネスが end-to-end で動く（T13②）", () => {
  it("ダミー埋め込みで指標が計算され、範囲（0..1）に収まる", async () => {
    const report = await runEval(
      orm,
      async (t) => fakeEmbedText(t),
      EVAL_CASES,
    );

    expect(report.metrics.queryCount).toBe(EVAL_CASES.length);
    for (const value of [
      report.metrics.meanRecallAtK,
      report.metrics.mrr,
      report.metrics.hitRateAtK,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    // 各質問レポートは期待銘柄が解決され、候補が返っている
    for (const c of report.cases) {
      expect(c.resolvedExpectedCount).toBeGreaterThanOrEqual(1);
      expect(c.candidateCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("実埋め込みを模した「期待銘柄そのものを近傍にする」注入では recall/MRR が最大化する（配線の妥当性）", async () => {
    // ハーネスの配線（retriever へ注入 → 距離 → 指標）が正しいことを、
    // 「クエリと期待銘柄が完全一致する理想埋め込み」で確認する。実埋め込みの品質検証ではなく、
    // ハーネス自体が“良い埋め込みなら高スコアを出せる”ことの担保。
    // ここでは freeText を持つ 1 ケースに対し、期待の 1 件だけを距離 0、他を直交にする。
    const target = EVAL_CASES[0];
    const targetName = target.expectedSakeNames[0];
    const rows = await orm
      .select({ id: schema.sakes.id, name: schema.sakes.name })
      .from(schema.sakes);
    const targetId = rows.find((r) => r.name === targetName)?.id;
    expect(targetId).toBeDefined();

    // beforeAll のダミー埋め込みを一旦消して、このテスト専用の理想埋め込みで置き換える。
    await orm.delete(schema.sakeEmbeddings);
    // 対象銘柄の埋め込みだけ oneHot(0)、それ以外は oneHot(1) を投入
    const oneHot = (i: number) => {
      const v = Array.from({ length: 1536 }, () => 0);
      v[i] = 1;
      return v;
    };
    for (const r of rows) {
      await orm.insert(schema.sakeEmbeddings).values({
        sakeId: r.id,
        embedding: r.id === targetId ? oneHot(0) : oneHot(1),
        model: "test",
        sourceHash: `hash-${r.id}`,
      });
    }

    // クエリ埋め込みを oneHot(0)（対象銘柄と同方向）に固定。タグ条件は外して純ベクタで測る。
    const singleCase = {
      label: target.label,
      query: { freeText: target.query.freeText },
      expectedSakeNames: [targetName],
    };
    const report = await runEval(orm, async () => oneHot(0), [singleCase], 5);
    // 対象が最上位 → hit@5・RR=1・recall=1
    expect(report.metrics.hitRateAtK).toBe(1);
    expect(report.metrics.mrr).toBeCloseTo(1);
    expect(report.metrics.meanRecallAtK).toBeCloseTo(1);

    await orm.delete(schema.sakeEmbeddings);
  });
});
