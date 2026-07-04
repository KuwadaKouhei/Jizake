import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import { importSakenowaSnapshot } from "./import-sakenowa";
import type { SakenowaSnapshot } from "./lib/sakenowa/client";
import areasFixture from "./lib/sakenowa/fixtures/areas.json";
import brandFlavorTagsFixture from "./lib/sakenowa/fixtures/brand-flavor-tags.json";
import brandsFixture from "./lib/sakenowa/fixtures/brands.json";
import breweriesFixture from "./lib/sakenowa/fixtures/breweries.json";
import flavorChartsFixture from "./lib/sakenowa/fixtures/flavor-charts.json";
import flavorTagsFixture from "./lib/sakenowa/fixtures/flavor-tags.json";
import rankingsFixture from "./lib/sakenowa/fixtures/rankings.json";
import {
  areasResponseSchema,
  brandFlavorTagsResponseSchema,
  brandsResponseSchema,
  breweriesResponseSchema,
  flavorChartsResponseSchema,
  flavorTagsResponseSchema,
  rankingsResponseSchema,
} from "./lib/sakenowa/schemas";

/**
 * インポートの統合テスト（PGlite = インプロセス Postgres ＋ drizzle/ の
 * マイグレーション一式）。実 API は叩かず、保存済みフィクスチャを使う
 * （TEST_PHILOSOPHY のフィクスチャ方針）。
 *
 * テストは同一 DB を共有し、上から順に「初回投入 → 冪等性 → 手作業データ保全 →
 * ランキング洗い替え → 重複蔵元統合 → 統合の順序非依存・統合先消失 →
 * 既存銘柄との衝突ガード → 不明タグ参照 → 名前の trim / 空文字スキップ」の
 * ストーリーで進む（実行順に依存する）。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

/** フィクスチャからスナップショットを組み立てる（毎回パースして変異を防ぐ） */
function loadSnapshot(): SakenowaSnapshot {
  return {
    areas: areasResponseSchema.parse(areasFixture),
    breweries: breweriesResponseSchema.parse(breweriesFixture),
    brands: brandsResponseSchema.parse(brandsFixture),
    flavorCharts: flavorChartsResponseSchema.parse(flavorChartsFixture),
    flavorTags: flavorTagsResponseSchema.parse(flavorTagsFixture),
    brandFlavorTags: brandFlavorTagsResponseSchema.parse(
      brandFlavorTagsFixture,
    ),
    rankings: rankingsResponseSchema.parse(rankingsFixture),
  };
}

/**
 * 合成スナップショットを組み立てる。本番と同じく Zod スキーマを通す
 * （trim 等の変換・検証がテストでも実行経路に入るようにするため）。
 */
function makeSnapshot(raw: {
  areas?: unknown;
  breweries?: unknown;
  brands?: unknown;
  flavorCharts?: unknown;
  flavorTags?: unknown;
  brandFlavorTags?: unknown;
  rankings?: unknown;
}): SakenowaSnapshot {
  return {
    areas: areasResponseSchema.parse(raw.areas ?? { areas: [] }),
    breweries: breweriesResponseSchema.parse(
      raw.breweries ?? { breweries: [] },
    ),
    brands: brandsResponseSchema.parse(raw.brands ?? { brands: [] }),
    flavorCharts: flavorChartsResponseSchema.parse(
      raw.flavorCharts ?? { flavorCharts: [] },
    ),
    flavorTags: flavorTagsResponseSchema.parse(raw.flavorTags ?? { tags: [] }),
    brandFlavorTags: brandFlavorTagsResponseSchema.parse(
      raw.brandFlavorTags ?? { flavorTags: [] },
    ),
    rankings: rankingsResponseSchema.parse(
      raw.rankings ?? { yearMonth: "202607", overall: [], areas: [] },
    ),
  };
}

/** created_at / updated_at を除いた全テーブルの状態（冪等性の比較用） */
async function dumpState() {
  const breweries = await orm
    .select({
      id: schema.breweries.id,
      sakenowaBreweryId: schema.breweries.sakenowaBreweryId,
      name: schema.breweries.name,
      prefectureCode: schema.breweries.prefectureCode,
    })
    .from(schema.breweries)
    .orderBy(schema.breweries.sakenowaBreweryId);
  const sakes = await orm
    .select({
      id: schema.sakes.id,
      sakenowaBrandId: schema.sakes.sakenowaBrandId,
      breweryId: schema.sakes.breweryId,
      name: schema.sakes.name,
      reading: schema.sakes.reading,
      description: schema.sakes.description,
      officialUrl: schema.sakes.officialUrl,
      amazonUrl: schema.sakes.amazonUrl,
      rakutenUrl: schema.sakes.rakutenUrl,
      priceRange: schema.sakes.priceRange,
      popularityRank: schema.sakes.popularityRank,
      flavorFloral: schema.sakes.flavorFloral,
      flavorMellow: schema.sakes.flavorMellow,
      flavorHeavy: schema.sakes.flavorHeavy,
      flavorMild: schema.sakes.flavorMild,
      flavorDry: schema.sakes.flavorDry,
      flavorLight: schema.sakes.flavorLight,
    })
    .from(schema.sakes)
    .orderBy(schema.sakes.sakenowaBrandId);
  const tags = await orm
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      category: schema.tags.category,
    })
    .from(schema.tags)
    .orderBy(schema.tags.name);
  const sakeTags = (
    await orm
      .select({
        sakeId: schema.sakeTags.sakeId,
        tagId: schema.sakeTags.tagId,
        source: schema.sakeTags.source,
      })
      .from(schema.sakeTags)
  ).sort((a, b) =>
    `${a.sakeId}:${a.tagId}`.localeCompare(`${b.sakeId}:${b.tagId}`),
  );
  return { breweries, sakes, tags, sakeTags };
}

async function findSakeByBrandId(brandId: number) {
  const [sake] = await orm
    .select()
    .from(schema.sakes)
    .where(sql`${schema.sakes.sakenowaBrandId} = ${brandId}`);
  return sake;
}

beforeAll(async () => {
  // Supabase 環境のスタブ（schema.test.ts と同じ。0002 のトリガ・RLS DDL が前提とする）
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

describe("importSakenowaSnapshot（フィクスチャ→PGlite）", () => {
  it("初回インポートで蔵元・銘柄・タグが投入され、例外データはスキップされる", async () => {
    const summary = await importSakenowaSnapshot(orm, loadSnapshot());

    // フィクスチャの構成: 蔵元 26（うち空文字名 1・areaId=0 が 1）、銘柄 27（うち
    // スキップ対象蔵元の銘柄 2）。fixtures/README.md 参照
    expect(summary.breweries).toEqual({
      upserted: 24,
      skippedOtherArea: 1,
      skippedEmptyName: 1,
      mergedDuplicateName: 0,
      mergedIntoExisting: 0,
    });
    expect(summary.sakes.upserted).toBe(25);
    expect(summary.sakes.skippedNoBrewery).toBe(2);
    expect(summary.sakes.skippedEmptyName).toBe(0);
    expect(summary.sakes.skippedConflictWithExisting).toBe(0);
    expect(summary.tags.unknownTagIdRefs).toBe(0);

    const state = await dumpState();
    expect(state.breweries).toHaveLength(24);
    expect(state.sakes).toHaveLength(25);
    // スキップ対象（空文字名・areaId=0）は投入されない
    expect(state.breweries.every((b) => b.name.trim() !== "")).toBe(true);
    expect(
      state.breweries.every((b) =>
        /^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(b.prefectureCode),
      ),
    ).toBe(true);

    // rankings から popularity_rank が反映される（brandId 109 = 総合 1 位）
    const ranked = await findSakeByBrandId(109);
    expect(ranked.popularityRank).toBe(1);

    // フレーバーチャートありの銘柄は 6 軸すべて入り、なしの銘柄はすべて NULL
    const withChart = state.sakes.filter((s) => s.flavorFloral !== null);
    expect(withChart.length).toBe(summary.sakes.withFlavorChart);
    for (const sake of state.sakes) {
      const axes = [
        sake.flavorFloral,
        sake.flavorMellow,
        sake.flavorHeavy,
        sake.flavorMild,
        sake.flavorDry,
        sake.flavorLight,
      ];
      const nullCount = axes.filter((v) => v === null).length;
      expect([0, 6]).toContain(nullCount);
    }

    // タグはすべて taste カテゴリ・タグ付けはすべて source='sakenowa'
    expect(state.tags.every((t) => t.category === "taste")).toBe(true);
    expect(state.sakeTags.length).toBeGreaterThan(0);
    expect(state.sakeTags.every((st) => st.source === "sakenowa")).toBe(true);

    // 手作業カラムは初回インポートでは NULL のまま
    expect(state.sakes.every((s) => s.description === null)).toBe(true);
  });

  it("2 回実行しても同一状態になる（冪等 upsert）", async () => {
    const before = await dumpState();
    const summary = await importSakenowaSnapshot(orm, loadSnapshot());
    const after = await dumpState();

    // UUID（PK）も含めて完全一致 = 行の消え残り・作り直しがない
    expect(after).toEqual(before);
    expect(summary.sakes.upserted).toBe(25);
  });

  it("再インポートで手作業データ（説明文等のカラム・manual タグ）を上書きしない", async () => {
    const sake = await findSakeByBrandId(109);

    // T04 の手作業シードを模擬: 説明文等の手作業カラムを設定
    await orm
      .update(schema.sakes)
      .set({
        reading: "あらまさ",
        description: "テスト用の自作説明文",
        officialUrl: "https://example.com/aramasa",
        priceRange: "over_3000",
      })
      .where(sql`${schema.sakes.id} = ${sake.id}`);

    // 手作業タグ（さけのわに無い組み合わせ）を付与
    const [manualTag] = await orm
      .insert(schema.tags)
      .values({ name: "純米大吟醸", category: "type" })
      .returning();
    await orm.insert(schema.sakeTags).values({
      sakeId: sake.id,
      tagId: manualTag.id,
      source: "manual",
    });

    // さけのわ由来と同じ (sake, tag) を手作業付与に変更したケース
    // （入れ替え後の再挿入が ON CONFLICT DO NOTHING で manual を優先すること）
    const [convertedRow] = await orm
      .update(schema.sakeTags)
      .set({ source: "manual" })
      .where(
        sql`${schema.sakeTags.sakeId} = ${sake.id} and ${schema.sakeTags.source} = 'sakenowa'`,
      )
      .returning();
    expect(convertedRow).toBeDefined();

    await importSakenowaSnapshot(orm, loadSnapshot());

    const reimported = await findSakeByBrandId(109);
    expect(reimported.reading).toBe("あらまさ");
    expect(reimported.description).toBe("テスト用の自作説明文");
    expect(reimported.officialUrl).toBe("https://example.com/aramasa");
    expect(reimported.priceRange).toBe("over_3000");
    // さけのわ由来のカラムは更新される（rank 1 のまま）
    expect(reimported.popularityRank).toBe(1);

    const manualRows = await orm
      .select()
      .from(schema.sakeTags)
      .where(sql`${schema.sakeTags.source} = 'manual'`);
    const manualPairs = manualRows.map((r) => `${r.sakeId}:${r.tagId}`);
    expect(manualPairs).toContain(`${sake.id}:${manualTag.id}`);
    expect(manualPairs).toContain(
      `${convertedRow.sakeId}:${convertedRow.tagId}`,
    );

    // manual タグ（type カテゴリ）はタグマスタにも残る
    const [tagAfter] = await orm
      .select()
      .from(schema.tags)
      .where(sql`${schema.tags.name} = '純米大吟醸'`);
    expect(tagAfter.category).toBe("type");
  });

  it("今回のランキングに載っていない銘柄の popularity_rank は NULL に戻る", async () => {
    const snapshot = loadSnapshot();
    snapshot.rankings = { ...snapshot.rankings, overall: [] };

    const summary = await importSakenowaSnapshot(orm, snapshot);
    expect(summary.sakes.withPopularityRank).toBe(0);

    const sake = await findSakeByBrandId(109);
    expect(sake.popularityRank).toBeNull();
  });

  it("同一 (name, prefecture) の重複蔵元は統合され、銘柄は統合先に付け替えられる", async () => {
    const sakeTagsBefore = await orm
      .select()
      .from(schema.sakeTags)
      .orderBy(schema.sakeTags.sakeId, schema.sakeTags.tagId);

    const synthetic = makeSnapshot({
      areas: { areas: [{ id: 25, name: "滋賀県" }] },
      breweries: {
        breweries: [
          { id: 999001, name: "重複検証酒造", areaId: 25 },
          { id: 999002, name: "重複検証酒造", areaId: 25 },
        ],
      },
      brands: {
        brands: [
          { id: 999101, name: "重複検証銘柄A", breweryId: 999001 },
          { id: 999102, name: "重複検証銘柄B", breweryId: 999002 },
          // 統合の結果、同一蔵元内で名前が重複する銘柄はスキップされる
          { id: 999103, name: "重複検証銘柄A", breweryId: 999002 },
        ],
      },
    });

    const summary = await importSakenowaSnapshot(orm, synthetic);
    expect(summary.breweries.upserted).toBe(1);
    expect(summary.breweries.mergedDuplicateName).toBe(1);
    expect(summary.breweries.mergedIntoExisting).toBe(0);
    expect(summary.sakes.upserted).toBe(2);
    expect(summary.sakes.skippedDuplicateName).toBe(1);

    const [mergedBrewery] = await orm
      .select()
      .from(schema.breweries)
      .where(sql`${schema.breweries.name} = '重複検証酒造'`);
    // 統合先はスナップショット内の最小 sakenowa 蔵元 ID
    expect(mergedBrewery.sakenowaBreweryId).toBe(999001);

    const brandA = await findSakeByBrandId(999101);
    const brandB = await findSakeByBrandId(999102);
    expect(brandA.breweryId).toBe(mergedBrewery.id);
    expect(brandB.breweryId).toBe(mergedBrewery.id);
    const brandDup = await findSakeByBrandId(999103);
    expect(brandDup).toBeUndefined();

    // スナップショットに含まれない既存データは削除されない（upsert 専用）
    const allSakes = await orm.select().from(schema.sakes);
    expect(allSakes.length).toBe(27); // フィクスチャ 25 + 合成 2

    // タグの入れ替えは「今回インポートした銘柄」に限定されるため、
    // スナップショット外の銘柄（フィクスチャ由来）のタグも消えない（S-1）
    const sakeTagsAfter = await orm
      .select()
      .from(schema.sakeTags)
      .orderBy(schema.sakeTags.sakeId, schema.sakeTags.tagId);
    expect(sakeTagsAfter).toEqual(sakeTagsBefore);
  });

  it("重複蔵元の並び順が変わっても統合先は同じ（B-1 回帰: 順序非依存）", async () => {
    const [breweryBefore] = await orm
      .select()
      .from(schema.breweries)
      .where(sql`${schema.breweries.name} = '重複検証酒造'`);

    // 前のテストと同じ内容で、配列の並び順だけを逆にした再インポート。
    // 「配列内で最初に出現した蔵元を統合先にする」旧実装では、統合先が
    // 999002 に変わって ON CONFLICT が発火せず UNIQUE 違反で失敗していた
    const reversed = makeSnapshot({
      areas: { areas: [{ id: 25, name: "滋賀県" }] },
      breweries: {
        breweries: [
          { id: 999002, name: "重複検証酒造", areaId: 25 },
          { id: 999001, name: "重複検証酒造", areaId: 25 },
        ],
      },
      brands: {
        brands: [
          { id: 999102, name: "重複検証銘柄B", breweryId: 999002 },
          { id: 999101, name: "重複検証銘柄A", breweryId: 999001 },
        ],
      },
    });

    const summary = await importSakenowaSnapshot(orm, reversed);
    expect(summary.breweries.upserted).toBe(1);
    expect(summary.breweries.mergedDuplicateName).toBe(1);

    // 統合先の行（uuid・sakenowa ID）が変わらない
    const [breweryAfter] = await orm
      .select()
      .from(schema.breweries)
      .where(sql`${schema.breweries.name} = '重複検証酒造'`);
    expect(breweryAfter.id).toBe(breweryBefore.id);
    expect(breweryAfter.sakenowaBreweryId).toBe(999001);

    const brandA = await findSakeByBrandId(999101);
    const brandB = await findSakeByBrandId(999102);
    expect(brandA.breweryId).toBe(breweryBefore.id);
    expect(brandB.breweryId).toBe(breweryBefore.id);
  });

  it("統合先だった sakenowa 蔵元 ID が API から消えても失敗せず、DB の既存行へ統合する（B-1 回帰）", async () => {
    const [breweryBefore] = await orm
      .select()
      .from(schema.breweries)
      .where(sql`${schema.breweries.name} = '重複検証酒造'`);
    expect(breweryBefore.sakenowaBreweryId).toBe(999001);

    // 統合先だった 999001 が消え、999002 だけが残ったスナップショット。
    // 旧実装では (999002, 重複検証酒造, 25) の INSERT が ON CONFLICT を
    // 発火させず UNIQUE (name, prefecture_code) 違反で恒久失敗していた
    const vanished = makeSnapshot({
      areas: { areas: [{ id: 25, name: "滋賀県" }] },
      breweries: {
        breweries: [{ id: 999002, name: "重複検証酒造", areaId: 25 }],
      },
      brands: {
        brands: [
          { id: 999102, name: "重複検証銘柄B", breweryId: 999002 },
          { id: 999104, name: "消失検証銘柄", breweryId: 999002 },
        ],
      },
    });

    const summary = await importSakenowaSnapshot(orm, vanished);
    expect(summary.breweries.upserted).toBe(0);
    expect(summary.breweries.mergedIntoExisting).toBe(1);
    expect(summary.sakes.upserted).toBe(2);

    // 既存行がそのまま統合先になる（新しい行は作られない）
    const rows = await orm
      .select()
      .from(schema.breweries)
      .where(sql`${schema.breweries.name} = '重複検証酒造'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(breweryBefore.id);
    expect(rows[0].sakenowaBreweryId).toBe(999001);

    const existingBrand = await findSakeByBrandId(999102);
    const newBrand = await findSakeByBrandId(999104);
    expect(existingBrand.breweryId).toBe(breweryBefore.id);
    expect(newBrand.breweryId).toBe(breweryBefore.id);
  });

  it("手作業銘柄と同一 (brewery_id, name) の銘柄はスキップされ、全体は失敗しない（S-2）", async () => {
    const [brewery] = await orm
      .select()
      .from(schema.breweries)
      .where(sql`${schema.breweries.name} = '重複検証酒造'`);

    // T04 の手作業シードを模擬: さけのわ ID を持たない銘柄
    await orm.insert(schema.sakes).values({
      breweryId: brewery.id,
      name: "手作業限定銘柄",
      description: "手作業で登録した銘柄",
    });

    // 同じ (brewery, name) の銘柄が API に現れたケース
    const conflicting = makeSnapshot({
      breweries: {
        breweries: [{ id: 999001, name: "重複検証酒造", areaId: 25 }],
      },
      brands: {
        brands: [{ id: 999105, name: "手作業限定銘柄", breweryId: 999001 }],
      },
    });

    const summary = await importSakenowaSnapshot(orm, conflicting);
    expect(summary.sakes.upserted).toBe(0);
    expect(summary.sakes.skippedConflictWithExisting).toBe(1);

    // 手作業銘柄は 1 行のまま・さけのわ ID は付かない・説明文も無傷
    const rows = await orm
      .select()
      .from(schema.sakes)
      .where(sql`${schema.sakes.name} = '手作業限定銘柄'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].sakenowaBrandId).toBeNull();
    expect(rows[0].description).toBe("手作業で登録した銘柄");
  });

  it("タグマスタに無い tagId への参照は件数を記録してスキップする（S-3）", async () => {
    const snapshot = makeSnapshot({
      breweries: {
        breweries: [{ id: 999001, name: "重複検証酒造", areaId: 25 }],
      },
      brands: {
        brands: [{ id: 999106, name: "タグ検証銘柄", breweryId: 999001 }],
      },
      flavorTags: { tags: [{ id: 1, tag: "酸味" }] },
      brandFlavorTags: {
        flavorTags: [{ brandId: 999106, tagIds: [1, 424242] }],
      },
    });

    const summary = await importSakenowaSnapshot(orm, snapshot);
    expect(summary.tags.unknownTagIdRefs).toBe(1);

    // 実在するタグ（酸味）だけが付与される
    const sake = await findSakeByBrandId(999106);
    const attached = await orm
      .select({ name: schema.tags.name, source: schema.sakeTags.source })
      .from(schema.sakeTags)
      .innerJoin(schema.tags, sql`${schema.tags.id} = ${schema.sakeTags.tagId}`)
      .where(sql`${schema.sakeTags.sakeId} = ${sake.id}`);
    expect(attached).toEqual([{ name: "酸味", source: "sakenowa" }]);
  });

  it("銘柄名は trim され、trim 後に空文字となる銘柄はスキップされる（S-4）", async () => {
    const snapshot = makeSnapshot({
      breweries: {
        breweries: [{ id: 999001, name: "  重複検証酒造  ", areaId: 25 }],
      },
      brands: {
        brands: [
          { id: 999107, name: "  トリム検証銘柄  ", breweryId: 999001 },
          { id: 999108, name: "   ", breweryId: 999001 },
        ],
      },
    });

    const summary = await importSakenowaSnapshot(orm, snapshot);
    expect(summary.sakes.upserted).toBe(1);
    expect(summary.sakes.skippedEmptyName).toBe(1);

    // 蔵元名も trim されて既存行に一致する（新規行が増えない）
    const breweryRows = await orm
      .select()
      .from(schema.breweries)
      .where(sql`${schema.breweries.name} like '%重複検証酒造%'`);
    expect(breweryRows).toHaveLength(1);

    const trimmed = await findSakeByBrandId(999107);
    expect(trimmed.name).toBe("トリム検証銘柄");
  });
});
