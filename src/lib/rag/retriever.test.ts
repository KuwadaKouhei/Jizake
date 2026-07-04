import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/models";
import * as schema from "@/lib/db/schema";

import {
  combineScore,
  type EmbedQueryFn,
  retrieveSakeCandidates,
  TAG_WEIGHT,
  VECTOR_WEIGHT,
} from "./retriever";

/**
 * ハイブリッド retriever のテスト（TASKS T12 ②④）。
 *
 * - スコア統合 combineScore は純関数として単体検証する。
 * - ハイブリッド検索は PGlite（+pgvector）＋ダミークエリベクトル注入で検証する
 *   （実 API を叩かない。TEST_PHILOSOPHY: retriever は実 DB でテスト）。
 *   ダミー埋め込みは「基底方向 index を 1、他を 0」の 1536 次元ワンホット風ベクトルにし、
 *   cosine 距離が制御できる（同方向=距離0、直交=距離1）ようにする。
 */

// ---------------------------------------------------------------------------
// スコア統合の純関数
// ---------------------------------------------------------------------------
describe("combineScore（ハイブリッド統合）", () => {
  it("ベクタ成分・タグ成分を重み付き和で足す", () => {
    // vectorSimilarity=1（完全一致）, タグ 2/2 一致
    expect(
      combineScore({
        vectorSimilarity: 1,
        matchedTagCount: 2,
        requestedTagCount: 2,
      }),
    ).toBeCloseTo(VECTOR_WEIGHT * 1 + TAG_WEIGHT * 1);
  });

  it("埋め込みが無い（vectorSimilarity=null）銘柄でもタグ成分だけでスコアが付く", () => {
    // ベクタ検索に出ない銘柄をタグで拾える設計の担保
    expect(
      combineScore({
        vectorSimilarity: null,
        matchedTagCount: 1,
        requestedTagCount: 2,
      }),
    ).toBeCloseTo(TAG_WEIGHT * 0.5);
  });

  it("要求タグ 0 のときタグ成分は評価に含めない（ベクタのみ）", () => {
    expect(
      combineScore({
        vectorSimilarity: 0.5,
        matchedTagCount: 0,
        requestedTagCount: 0,
      }),
    ).toBeCloseTo(VECTOR_WEIGHT * 0.5);
  });

  it("タグも freeText も無い候補は score 0", () => {
    expect(
      combineScore({
        vectorSimilarity: null,
        matchedTagCount: 0,
        requestedTagCount: 0,
      }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ハイブリッド統合テスト（PGlite + pgvector + ダミー埋め込み）
// ---------------------------------------------------------------------------
const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

/** 指定 index を 1、他を 0 とする 1536 次元ワンホットベクトル。 */
function oneHot(index: number): number[] {
  const v = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  v[index] = 1;
  return v;
}

/** 指定 index を -1、他を 0 とする逆向きベクトル（query の oneHot と cosine 距離 2＝真逆）。 */
function reversedOneHot(index: number): number[] {
  const v = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  v[index] = -1;
  return v;
}

/** クエリ文字列 → ワンホットベクトルへ写す注入用埋め込み（決定的・実 API 非依存）。 */
function fakeEmbedForIndex(index: number): EmbedQueryFn {
  return async () => oneHot(index);
}

async function seedBrewery(name: string, prefectureCode: string) {
  const [row] = await orm
    .insert(schema.breweries)
    .values({ name, prefectureCode })
    .returning({ id: schema.breweries.id });
  return row.id;
}

async function seedSake(
  breweryId: string,
  name: string,
  opts: { popularityRank?: number; priceRange?: string } = {},
) {
  const [row] = await orm
    .insert(schema.sakes)
    .values({
      breweryId,
      name,
      popularityRank: opts.popularityRank,
      priceRange: opts.priceRange,
    })
    .returning({ id: schema.sakes.id });
  return row.id;
}

async function seedEmbedding(sakeId: string, embedding: number[] = oneHot(0)) {
  await orm.insert(schema.sakeEmbeddings).values({
    sakeId,
    embedding,
    model: "test",
    sourceHash: `hash-${sakeId}`,
  });
}

async function tagSake(sakeId: string, tagName: string) {
  const existing = await orm
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(eq(schema.tags.name, tagName));
  let tagId = existing[0]?.id;
  if (tagId === undefined) {
    const [row] = await orm
      .insert(schema.tags)
      .values({ name: tagName, category: "taste" })
      .returning({ id: schema.tags.id });
    tagId = row.id;
  }
  await orm.insert(schema.sakeTags).values({ sakeId, tagId, source: "manual" });
}

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
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await orm.delete(schema.sakeEmbeddings);
  await orm.delete(schema.sakeTags);
  await orm.delete(schema.sakes);
  await orm.delete(schema.breweries);
  await orm.delete(schema.tags);
});

describe("retrieveSakeCandidates（ハイブリッド検索）", () => {
  it("freeText でクエリベクトルに近い銘柄が上位に来る", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const near = await seedSake(breweryId, "近い酒");
    const far = await seedSake(breweryId, "遠い酒");
    await seedEmbedding(near, oneHot(0)); // クエリ(index0)と同方向 → 距離 0
    await seedEmbedding(far, oneHot(1)); // 直交 → 距離 1

    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      freeText: "近い味が好き",
    });

    expect(result[0].sake.id).toBe(near);
    expect(result[0].vectorSimilarity).toBeCloseTo(1);
    // 近い銘柄のスコアが遠い銘柄より高い
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it("タグ絞り込みが効く（要求タグを持つ銘柄だけ残る）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const dry = await seedSake(breweryId, "辛口の酒");
    const sweet = await seedSake(breweryId, "甘口の酒");
    await tagSake(dry, "辛口");
    await tagSake(sweet, "甘口");

    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      tagNames: ["辛口"],
    });

    expect(result.map((r) => r.sake.id)).toEqual([dry]);
    expect(result[0].matchedTagCount).toBe(1);
  });

  it("複数タグは AND 絞り込み（両方持つ銘柄だけ残る）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const both = await seedSake(breweryId, "辛口かつ淡麗");
    const onlyDry = await seedSake(breweryId, "辛口だけ");
    await tagSake(both, "辛口");
    await tagSake(both, "淡麗");
    await tagSake(onlyDry, "辛口");

    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      tagNames: ["辛口", "淡麗"],
    });

    expect(result.map((r) => r.sake.id)).toEqual([both]);
  });

  it("埋め込みが無い銘柄もタグ検索で拾える（ベクタ検索に出ない銘柄を落とさない）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const noEmbedding = await seedSake(breweryId, "埋め込み無しの辛口");
    await tagSake(noEmbedding, "辛口");
    // 埋め込みは付けない

    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      freeText: "辛口が飲みたい",
      tagNames: ["辛口"],
    });

    expect(result.map((r) => r.sake.id)).toEqual([noEmbedding]);
    // 埋め込みが無いので vectorSimilarity は null、タグ成分だけでスコアが付く
    expect(result[0].vectorSimilarity).toBeNull();
    expect(result[0].matchedTagCount).toBe(1);
  });

  it("都道府県で絞り込める", async () => {
    const yamaguchi = await seedBrewery("旭酒造", "35");
    const niigata = await seedBrewery("八海醸造", "15");
    const dassai = await seedSake(yamaguchi, "獺祭");
    await seedSake(niigata, "八海山");

    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      prefectureCode: "35",
    });

    expect(result.map((r) => r.sake.id)).toEqual([dassai]);
  });

  it("価格帯で絞り込める", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const cheap = await seedSake(breweryId, "安い酒", {
      priceRange: "under_1500",
    });
    await seedSake(breweryId, "高い酒", { priceRange: "over_3000" });

    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      priceRange: "under_1500",
    });

    expect(result.map((r) => r.sake.id)).toEqual([cheap]);
  });

  it("上位 N 件（limit）に絞る", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    for (let i = 0; i < 5; i++) {
      await seedSake(breweryId, `酒${i}`, { popularityRank: i + 1 });
    }

    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      limit: 3,
    });
    expect(result).toHaveLength(3);
  });

  it("limit が 0 以下なら空配列（埋め込みも呼ばない）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    await seedSake(breweryId, "酒");

    let called = false;
    const embed: EmbedQueryFn = async () => {
      called = true;
      return oneHot(0);
    };
    const result = await retrieveSakeCandidates(orm, embed, {
      freeText: "何か",
      limit: 0,
    });
    expect(result).toEqual([]);
    expect(called).toBe(false);
  });

  it("freeText が無ければ埋め込みを呼ばず、人気順で返す", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const rank2 = await seedSake(breweryId, "二番人気", { popularityRank: 2 });
    const rank1 = await seedSake(breweryId, "一番人気", { popularityRank: 1 });

    let called = false;
    const embed: EmbedQueryFn = async () => {
      called = true;
      return oneHot(0);
    };
    const result = await retrieveSakeCandidates(orm, embed, {});

    expect(called).toBe(false);
    // 人気順（rank 昇順）で返る
    expect(result.map((r) => r.sake.id)).toEqual([rank1, rank2]);
    expect(result.every((r) => r.vectorSimilarity === null)).toBe(true);
  });

  it("条件に一致する候補が無ければ空配列", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    await seedSake(breweryId, "酒");
    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      prefectureCode: "01", // 該当なし
    });
    expect(result).toEqual([]);
  });

  it("返す候補は必ず実在の sakeId を含む（捏造防止の一段目）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const id = await seedSake(breweryId, "獺祭");
    await seedEmbedding(id, oneHot(0));

    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      freeText: "何か",
    });
    const existing = await orm
      .select({ id: schema.sakes.id })
      .from(schema.sakes);
    const existingIds = new Set(existing.map((r) => r.id));
    expect(result.every((r) => existingIds.has(r.sake.id))).toBe(true);
  });

  it("逆向き埋め込み（負の類似）でもタグ一致なら埋め込み無しと同等以上（vectorSimilarity クランプ。CODE S-1）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    // 逆向き埋め込み（クエリと真逆＝cosine 距離 2、1-2=-1）だがタグ一致
    const reversed = await seedSake(breweryId, "逆向き辛口");
    await seedEmbedding(reversed, reversedOneHot(0));
    await tagSake(reversed, "辛口");
    // 埋め込み無し＋タグ一致
    const noEmbedding = await seedSake(breweryId, "埋め込み無し辛口");
    await tagSake(noEmbedding, "辛口");

    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      freeText: "辛口が好き",
      tagNames: ["辛口"],
    });

    const byId = new Map(result.map((r) => [r.sake.id, r]));
    const reversedCand = byId.get(reversed);
    const noEmbCand = byId.get(noEmbedding);
    // 逆向きは負にならず 0 にクランプされる（順位逆転を防ぐ）
    expect(reversedCand?.vectorSimilarity).toBe(0);
    // 両者ともタグ 1/1 一致・ベクタ成分 0 なので score は同点（逆向きが沈まない）
    expect(reversedCand?.score).toBeCloseTo(noEmbCand?.score ?? -1);
    expect(reversedCand?.score).toBeGreaterThanOrEqual(noEmbCand?.score ?? 0);
  });

  it("limit は母集団上限（CANDIDATE_POOL_SIZE）にクランプされる（値渡しミス耐性。SEC S-3）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    for (let i = 0; i < 3; i++) {
      await seedSake(breweryId, `酒${i}`, { popularityRank: i + 1 });
    }
    // 巨大 limit を渡しても件数分だけ返り、例外にならない
    const result = await retrieveSakeCandidates(orm, fakeEmbedForIndex(0), {
      limit: 100000,
    });
    expect(result).toHaveLength(3);
  });

  it("巨大 freeText でも切り詰めてから埋め込みに渡す（SEC S-2）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const id = await seedSake(breweryId, "獺祭");
    await seedEmbedding(id, oneHot(0));

    // 埋め込みに渡された文字列長を記録する注入関数
    let receivedLength = -1;
    const embed: EmbedQueryFn = async (text) => {
      receivedLength = text.length;
      return oneHot(0);
    };
    await retrieveSakeCandidates(orm, embed, {
      freeText: "あ".repeat(5000),
    });
    // MAX_FREE_TEXT_LENGTH(1000) 以下に切り詰められている
    expect(receivedLength).toBeLessThanOrEqual(1000);
    expect(receivedLength).toBeGreaterThan(0);
  });
});
