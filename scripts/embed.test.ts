import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  buildEmbeddingText,
  computeSourceHash,
  type EmbedTextsFn,
} from "@/lib/ai/embedding";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from "@/lib/ai/models";
import * as schema from "@/lib/db/schema";

import { embedSakes, selectWorkItems, type EmbeddingCandidate } from "./embed";

/**
 * 差分埋め込みパイプラインのテスト（TASKS T11 ⑤）。
 *
 * - 差分判定 selectWorkItems は純関数として単体検証する。
 * - パイプライン全体は PGlite（インプロセス Postgres + pgvector）＋
 *   決定的なフェイク埋め込み注入で検証する（実 API は叩かない。TEST_PHILOSOPHY）。
 */

// ---------------------------------------------------------------------------
// 差分判定の純関数
// ---------------------------------------------------------------------------
describe("selectWorkItems（差分判定）", () => {
  const candidate = (
    over: Partial<EmbeddingCandidate> = {},
  ): EmbeddingCandidate => ({
    sakeId: "s1",
    name: "獺祭",
    breweryName: "旭酒造",
    prefectureCode: "35",
    description: "華やかな味わい。",
    tagNames: ["華やか"],
    ...over,
  });

  const hashOf = (c: EmbeddingCandidate) =>
    computeSourceHash(
      buildEmbeddingText({
        name: c.name,
        breweryName: c.breweryName,
        prefectureCode: c.prefectureCode,
        description: c.description,
        tagNames: c.tagNames,
      }),
    );

  it("未登録の銘柄は再埋め込み対象になる", () => {
    const c = candidate();
    const work = selectWorkItems([c], new Map(), EMBEDDING_MODEL_ID);
    expect(work).toHaveLength(1);
    expect(work[0].sakeId).toBe("s1");
    expect(work[0].sourceHash).toBe(hashOf(c));
  });

  it("source_hash・model がともに一致する銘柄は対象外（差分なし）", () => {
    const c = candidate();
    const existing = new Map([
      ["s1", { sourceHash: hashOf(c), model: EMBEDDING_MODEL_ID }],
    ]);
    expect(selectWorkItems([c], existing, EMBEDDING_MODEL_ID)).toHaveLength(0);
  });

  it("説明文が変わって source_hash が変化した銘柄は再埋め込み対象になる", () => {
    const before = candidate();
    const after = candidate({ description: "辛口でキレのある味わい。" });
    const existing = new Map([
      ["s1", { sourceHash: hashOf(before), model: EMBEDDING_MODEL_ID }],
    ]);
    const work = selectWorkItems([after], existing, EMBEDDING_MODEL_ID);
    expect(work).toHaveLength(1);
    expect(work[0].sourceHash).toBe(hashOf(after));
  });

  it("model が異なる（モデル差し替え）銘柄は source_hash 一致でも再埋め込み対象になる", () => {
    const c = candidate();
    const existing = new Map([
      ["s1", { sourceHash: hashOf(c), model: "openai/old-model" }],
    ]);
    expect(selectWorkItems([c], existing, EMBEDDING_MODEL_ID)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// パイプライン統合テスト（PGlite + フェイク埋め込み）
// ---------------------------------------------------------------------------
const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

// 決定的なフェイク埋め込み: テキスト文字数を基点に 1536 次元を埋める。
// テキストごとに異なり、同一テキストなら同一ベクトルになる（実 API を模す）。
const fakeEmbed: EmbedTextsFn = async (texts) =>
  texts.map((text) => {
    const seed = text.length;
    return Array.from(
      { length: EMBEDDING_DIMENSIONS },
      (_v, i) => ((seed + i) % 100) / 100,
    );
  });

// 埋め込み呼び出し回数と入力を記録するスパイ（差分のみ埋め込むことの検証用）。
function spyEmbed(): EmbedTextsFn & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = (async (texts) => {
    calls.push([...texts]);
    return fakeEmbed(texts);
  }) as EmbedTextsFn & { calls: string[][] };
  fn.calls = calls;
  return fn;
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
  description: string | null,
) {
  const [row] = await orm
    .insert(schema.sakes)
    .values({ breweryId, name, description })
    .returning({ id: schema.sakes.id });
  return row.id;
}

async function readEmbeddings() {
  return orm
    .select({
      sakeId: schema.sakeEmbeddings.sakeId,
      model: schema.sakeEmbeddings.model,
      sourceHash: schema.sakeEmbeddings.sourceHash,
    })
    .from(schema.sakeEmbeddings)
    .orderBy(schema.sakeEmbeddings.sakeId);
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
  // 各テストを独立させる（外部キー順に全消去）
  await orm.delete(schema.sakeEmbeddings);
  await orm.delete(schema.sakeTags);
  await orm.delete(schema.sakes);
  await orm.delete(schema.breweries);
});

describe("embedSakes（差分埋め込みパイプライン）", () => {
  it("初回は説明文を持つ全銘柄を埋め込む（説明文なしは対象外）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    await seedSake(breweryId, "獺祭", "華やかな味わい。");
    await seedSake(breweryId, "獺祭 スパークリング", "微発泡で爽やか。");
    // 説明文なしは埋め込み対象にならない
    await seedSake(breweryId, "説明なし", null);

    const embed = spyEmbed();
    const summary = await embedSakes(orm, embed);

    expect(summary.candidates).toBe(2);
    expect(summary.embedded).toBe(2);
    expect(summary.reused).toBe(0);
    expect(embed.calls.flat()).toHaveLength(2);

    const rows = await readEmbeddings();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.model === EMBEDDING_MODEL_ID)).toBe(true);
  });

  it("1536 次元のベクトルが格納される", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const sakeId = await seedSake(breweryId, "獺祭", "華やかな味わい。");
    await embedSakes(orm, fakeEmbed);

    // 格納された vector の次元を確認する
    const [{ dims }] = await orm
      .select({
        dims: sql<number>`vector_dims(${schema.sakeEmbeddings.embedding})`,
      })
      .from(schema.sakeEmbeddings)
      .where(eq(schema.sakeEmbeddings.sakeId, sakeId));
    expect(Number(dims)).toBe(EMBEDDING_DIMENSIONS);
  });

  it("2 回目は差分がなければ 1 件も埋め込まない（差分埋め込み）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    await seedSake(breweryId, "獺祭", "華やかな味わい。");
    await embedSakes(orm, fakeEmbed);

    const embed = spyEmbed();
    const summary = await embedSakes(orm, embed);

    expect(summary.candidates).toBe(1);
    expect(summary.embedded).toBe(0);
    expect(summary.reused).toBe(1);
    expect(embed.calls.flat()).toHaveLength(0);
  });

  it("説明文を変えた銘柄だけ再埋め込みし、source_hash が更新される", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const changedId = await seedSake(breweryId, "獺祭", "華やかな味わい。");
    const keptId = await seedSake(breweryId, "獺祭 45", "繊細な味わい。");
    await embedSakes(orm, fakeEmbed);
    const before = await readEmbeddings();
    const hashBefore = new Map(before.map((r) => [r.sakeId, r.sourceHash]));

    // 1 銘柄だけ説明文を更新する
    await orm
      .update(schema.sakes)
      .set({ description: "辛口でキレのある味わい。" })
      .where(eq(schema.sakes.id, changedId));

    const embed = spyEmbed();
    const summary = await embedSakes(orm, embed);

    expect(summary.embedded).toBe(1);
    expect(summary.reused).toBe(1);
    expect(embed.calls.flat()).toHaveLength(1);

    const after = await readEmbeddings();
    const hashAfter = new Map(after.map((r) => [r.sakeId, r.sourceHash]));
    // 変更した銘柄の source_hash は変わり、変えていない銘柄は変わらない
    expect(hashAfter.get(changedId)).not.toBe(hashBefore.get(changedId));
    expect(hashAfter.get(keptId)).toBe(hashBefore.get(keptId));
  });

  it("model を差し替えると source_hash 一致でも全件再埋め込みする", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    await seedSake(breweryId, "獺祭", "華やかな味わい。");
    await embedSakes(orm, fakeEmbed, "openai/text-embedding-3-small");

    const embed = spyEmbed();
    const summary = await embedSakes(
      orm,
      embed,
      "openai/text-embedding-3-large",
    );

    expect(summary.embedded).toBe(1);
    expect(embed.calls.flat()).toHaveLength(1);
    const [row] = await readEmbeddings();
    expect(row.model).toBe("openai/text-embedding-3-large");
  });

  it("タグを埋め込みテキストに含める（タグ変化で再埋め込み）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const sakeId = await seedSake(breweryId, "獺祭", "華やかな味わい。");
    await embedSakes(orm, fakeEmbed);
    const [before] = await readEmbeddings();

    // タグを付与する（source は問わない＝全タグを埋め込みテキストに含める）
    const [tag] = await orm
      .insert(schema.tags)
      .values({ name: "華やか", category: "taste" })
      .returning({ id: schema.tags.id });
    await orm
      .insert(schema.sakeTags)
      .values({ sakeId, tagId: tag.id, source: "sakenowa" });

    const summary = await embedSakes(orm, fakeEmbed);
    expect(summary.embedded).toBe(1);
    const [after] = await readEmbeddings();
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });
});
