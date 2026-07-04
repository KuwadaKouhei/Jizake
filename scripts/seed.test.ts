import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SEED_SAKES } from "../seed-data/sakes";
import * as schema from "@/lib/db/schema";
import { PREFECTURES } from "@/lib/constants/prefectures";
import { PRICE_RANGES } from "@/lib/constants/price-ranges";

import { seedSakes } from "./seed";
import { parseSeedSakes, seedSakesSchema } from "./lib/seed/schema";

/**
 * 手作業シードの妥当性テスト（データファイル）＋ 投入の統合テスト（PGlite）。
 *
 * データファイルの妥当性は境界スキーマ（scripts/lib/seed/schema.ts）で検証し、
 * 投入は PGlite（インプロセス Postgres ＋ drizzle/ のマイグレーション一式）で
 * 冪等性・さけのわ由来データとの共存・manual タグ付与を実証する
 * （TEST_PHILOSOPHY: テスト DB は PGlite・LLM 等の外部依存は使わない）。
 */

// ---------------------------------------------------------------------------
// データファイルの妥当性（DB を使わない純粋な検証）
// ---------------------------------------------------------------------------
describe("seed-data/sakes.ts の妥当性", () => {
  const PREFECTURE_CODES = new Set(PREFECTURES.map((p) => p.code));
  const PRICE_RANGE_VALUES = new Set(PRICE_RANGES.map((r) => r.value));

  it("境界スキーマ（parseSeedSakes）を通過する", () => {
    expect(() => parseSeedSakes(SEED_SAKES)).not.toThrow();
  });

  it("PoC を見据えて説明文つき銘柄が 50 件以上ある", () => {
    expect(SEED_SAKES.length).toBeGreaterThanOrEqual(50);
  });

  it("全銘柄が必須項目（name・brewery・prefectureCode・reading・description・typeTags）を持つ", () => {
    for (const seed of SEED_SAKES) {
      expect(seed.name.trim()).not.toBe("");
      expect(seed.brewery.trim()).not.toBe("");
      expect(seed.prefectureCode).toMatch(/^(0[1-9]|[1-3][0-9]|4[0-7])$/);
      expect(seed.reading.trim()).not.toBe("");
      expect(seed.description.trim()).not.toBe("");
      expect(seed.typeTags.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("説明文がすべて空でない（著作権上さけのわから取得できず自作が必須）", () => {
    expect(SEED_SAKES.every((s) => s.description.trim().length > 0)).toBe(true);
  });

  it("都道府県コードがすべて JIS の 01..47 に含まれる", () => {
    expect(
      SEED_SAKES.every((s) => PREFECTURE_CODES.has(s.prefectureCode)),
    ).toBe(true);
  });

  it("price_range が指定される場合は DATABASE.md の CHECK 値と一致する", () => {
    for (const seed of SEED_SAKES) {
      if (seed.priceRange !== undefined) {
        expect(PRICE_RANGE_VALUES.has(seed.priceRange)).toBe(true);
      }
    }
  });

  it("同一蔵元内の銘柄名に重複が無い（UNIQUE(brewery_id, name) を満たす）", () => {
    const keys = SEED_SAKES.map(
      (s) => `${s.prefectureCode}:${s.brewery}:${s.name}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("必須項目が欠けたデータはスキーマ検証で弾かれる（負のケース）", () => {
    const invalid = [
      {
        name: "検証用",
        brewery: "検証蔵",
        prefectureCode: "99", // 存在しない都道府県
        reading: "けんしょう",
        description: "説明",
        typeTags: ["純米"],
      },
    ];
    expect(() => seedSakesSchema.parse(invalid)).toThrow();
  });

  it("説明文が空のデータはスキーマ検証で弾かれる（負のケース）", () => {
    const invalid = [
      {
        name: "検証用",
        brewery: "検証蔵",
        prefectureCode: "13",
        reading: "けんしょう",
        description: "   ", // 空白のみ
        typeTags: ["純米"],
      },
    ];
    expect(() => seedSakesSchema.parse(invalid)).toThrow();
  });

  it("危険なスキームや http の URL はスキーマ検証で弾かれる（負のケース）", () => {
    const base = {
      name: "検証用",
      brewery: "検証蔵",
      prefectureCode: "13",
      reading: "けんしょう",
      description: "説明",
      typeTags: ["純米"],
    };
    for (const officialUrl of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "http://example.com", // https 以外は不可
    ]) {
      expect(() => seedSakesSchema.parse([{ ...base, officialUrl }])).toThrow();
    }
    // https は許可される
    expect(() =>
      seedSakesSchema.parse([{ ...base, officialUrl: "https://example.com" }]),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 投入の統合テスト（PGlite）
// ---------------------------------------------------------------------------
const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

/** 冪等性の比較用に全テーブルの状態を取り出す（created_at / updated_at は除く） */
async function dumpState() {
  const breweries = await orm
    .select({
      id: schema.breweries.id,
      sakenowaBreweryId: schema.breweries.sakenowaBreweryId,
      name: schema.breweries.name,
      prefectureCode: schema.breweries.prefectureCode,
    })
    .from(schema.breweries)
    .orderBy(schema.breweries.prefectureCode, schema.breweries.name);
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
      priceRange: schema.sakes.priceRange,
      popularityRank: schema.sakes.popularityRank,
      flavorFloral: schema.sakes.flavorFloral,
    })
    .from(schema.sakes)
    .orderBy(schema.sakes.name);
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

async function findSakeByName(name: string) {
  const [sake] = await orm
    .select()
    .from(schema.sakes)
    .where(sql`${schema.sakes.name} = ${name}`);
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

describe("seedSakes（seed-data → PGlite）", () => {
  it("初回投入で蔵元・銘柄・種別タグが入り、手作業カラムが設定される", async () => {
    const seeds = parseSeedSakes(SEED_SAKES);
    const summary = await seedSakes(orm, seeds);

    expect(summary.sakes.upserted).toBe(seeds.length);
    // 一意な蔵元数だけ upsert される
    const uniqueBreweries = new Set(
      seeds.map((s) => `${s.prefectureCode}:${s.brewery}`),
    );
    expect(summary.breweries.upserted).toBe(uniqueBreweries.size);

    const state = await dumpState();
    expect(state.sakes).toHaveLength(seeds.length);
    expect(state.breweries).toHaveLength(uniqueBreweries.size);

    // 全銘柄に自作説明文と読み仮名が入る（NOT NULL 相当の充足）
    expect(state.sakes.every((s) => (s.description ?? "").length > 0)).toBe(
      true,
    );
    expect(state.sakes.every((s) => (s.reading ?? "").length > 0)).toBe(true);

    // 種別タグはすべて category='type'、タグ付けはすべて source='manual'
    expect(state.tags.every((t) => t.category === "type")).toBe(true);
    expect(state.sakeTags.length).toBeGreaterThan(0);
    expect(state.sakeTags.every((st) => st.source === "manual")).toBe(true);

    // 都道府県コードはすべて JIS 01..47
    expect(
      state.breweries.every((b) =>
        /^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(b.prefectureCode),
      ),
    ).toBe(true);
  });

  it("2 回実行しても同一状態になる（冪等 upsert）", async () => {
    const seeds = parseSeedSakes(SEED_SAKES);
    const before = await dumpState();
    const summary = await seedSakes(orm, seeds);
    const after = await dumpState();

    // UUID（PK）も含めて完全一致 = 行の消え残り・作り直しがない
    expect(after).toEqual(before);
    expect(summary.sakes.upserted).toBe(seeds.length);
  });

  it("説明文・タグを差し替えると手作業カラムと manual タグが更新される（冪等な再投入）", async () => {
    // 獺祭 45 の 1 銘柄だけを対象に、説明文と種別タグを差し替える
    const target = SEED_SAKES.find((s) => s.name === "獺祭 純米大吟醸 45");
    expect(target).toBeDefined();
    const modified = {
      ...target!,
      description: "差し替えた自作説明文です。",
      priceRange: "over_3000" as const,
      typeTags: ["純米大吟醸", "無濾過"],
    };

    await seedSakes(orm, [modified]);

    const sake = await findSakeByName("獺祭 純米大吟醸 45");
    expect(sake.description).toBe("差し替えた自作説明文です。");
    expect(sake.priceRange).toBe("over_3000");

    // manual タグが入れ替わり、シードから外れた種別タグは掃除される
    const attached = await orm
      .select({ name: schema.tags.name, source: schema.sakeTags.source })
      .from(schema.sakeTags)
      .innerJoin(schema.tags, sql`${schema.tags.id} = ${schema.sakeTags.tagId}`)
      .where(sql`${schema.sakeTags.sakeId} = ${sake.id}`)
      .orderBy(schema.tags.name);
    expect(attached).toEqual([
      { name: "無濾過", source: "manual" },
      { name: "純米大吟醸", source: "manual" },
    ]);

    // 元データに戻して以降のテストへ影響させない（冪等性の確認も兼ねる）
    await seedSakes(orm, parseSeedSakes(SEED_SAKES));
    const restored = await findSakeByName("獺祭 純米大吟醸 45");
    expect(restored.description).toBe(target!.description);
  });
});

describe("さけのわ由来データとの共存", () => {
  it("既存の さけのわ蔵元 に手作業銘柄を付与しても さけのわカラムを壊さない", async () => {
    // T03 の さけのわインポートを模擬: sakenowa_brewery_id を持つ蔵元と銘柄
    const [sakenowaBrewery] = await orm
      .insert(schema.breweries)
      .values({
        sakenowaBreweryId: 900001,
        name: "共存検証酒造",
        prefectureCode: "13",
      })
      .returning();
    const [sakenowaSake] = await orm
      .insert(schema.sakes)
      .values({
        sakenowaBrandId: 900101,
        breweryId: sakenowaBrewery.id,
        name: "共存検証 既存銘柄",
        popularityRank: 5,
        flavorFloral: 0.5,
        flavorMellow: 0.5,
        flavorHeavy: 0.5,
        flavorMild: 0.5,
        flavorDry: 0.5,
        flavorLight: 0.5,
      })
      .returning();
    // さけのわ由来の味タグ（source='sakenowa'）を付与
    const [sakenowaTag] = await orm
      .insert(schema.tags)
      .values({ name: "華やか", category: "taste" })
      .returning();
    await orm.insert(schema.sakeTags).values({
      sakeId: sakenowaSake.id,
      tagId: sakenowaTag.id,
      source: "sakenowa",
    });

    // (name, prefecture_code) が一致する蔵元へ、手作業銘柄と手作業説明文を投入。
    // さらに既存 さけのわ銘柄 に手作業カラムを付与する
    const seeds = parseSeedSakes([
      {
        name: "共存検証 既存銘柄",
        brewery: "共存検証酒造",
        prefectureCode: "13",
        reading: "きょうぞんけんしょう きぞんめいがら",
        description: "既存さけのわ銘柄に付与する自作説明文。",
        typeTags: ["純米吟醸"],
        priceRange: "from_1500_to_3000",
      },
      {
        name: "共存検証 手作業銘柄",
        brewery: "共存検証酒造",
        prefectureCode: "13",
        reading: "きょうぞんけんしょう てさぎょうめいがら",
        description: "手作業で追加する銘柄の自作説明文。",
        typeTags: ["純米大吟醸"],
        priceRange: "over_3000",
      },
    ]);
    const summary = await seedSakes(orm, seeds);
    // 蔵元は新規作成されず既存を再利用する
    expect(summary.breweries.upserted).toBe(1);
    expect(summary.sakes.upserted).toBe(2);

    // 蔵元行は増えず、さけのわ ID も保全される
    const breweryRows = await orm
      .select()
      .from(schema.breweries)
      .where(sql`${schema.breweries.name} = '共存検証酒造'`);
    expect(breweryRows).toHaveLength(1);
    expect(breweryRows[0].sakenowaBreweryId).toBe(900001);
    expect(breweryRows[0].id).toBe(sakenowaBrewery.id);

    // 既存 さけのわ銘柄: 手作業カラムが付き、さけのわ由来カラムは保全される
    const existing = await findSakeByName("共存検証 既存銘柄");
    expect(existing.id).toBe(sakenowaSake.id);
    expect(existing.sakenowaBrandId).toBe(900101);
    expect(existing.popularityRank).toBe(5);
    expect(existing.flavorFloral).toBe(0.5);
    expect(existing.description).toBe("既存さけのわ銘柄に付与する自作説明文。");
    expect(existing.priceRange).toBe("from_1500_to_3000");

    // 手作業銘柄は新規行として入り、さけのわ ID を持たない
    const manualSake = await findSakeByName("共存検証 手作業銘柄");
    expect(manualSake.sakenowaBrandId).toBeNull();
    expect(manualSake.breweryId).toBe(sakenowaBrewery.id);

    // さけのわ由来の味タグ（source='sakenowa'）は消えない
    const sakenowaTagRows = await orm
      .select()
      .from(schema.sakeTags)
      .where(
        sql`${schema.sakeTags.sakeId} = ${sakenowaSake.id} and ${schema.sakeTags.source} = 'sakenowa'`,
      );
    expect(sakenowaTagRows).toHaveLength(1);
    expect(sakenowaTagRows[0].tagId).toBe(sakenowaTag.id);

    // 既存銘柄には manual の種別タグも付く（sakenowa と共存）
    const manualTagRows = await orm
      .select({ name: schema.tags.name })
      .from(schema.sakeTags)
      .innerJoin(schema.tags, sql`${schema.tags.id} = ${schema.sakeTags.tagId}`)
      .where(
        sql`${schema.sakeTags.sakeId} = ${sakenowaSake.id} and ${schema.sakeTags.source} = 'manual'`,
      );
    expect(manualTagRows.map((r) => r.name)).toEqual(["純米吟醸"]);
  });

  it("種別語と同名の味タグ（別カテゴリ）が既存だと、味タグへ誤紐付けせず停止する", async () => {
    // さけのわ由来の味タグとして、種別語と同名の「衝突検証味タグ」を先に占有させる
    // （seed-data には存在しない語を使う）。tags.name は UNIQUE（DB-10）なので、
    // シードはこれを種別タグとして入れられない。
    const collidingName = "衝突検証味タグ";
    await orm
      .insert(schema.tags)
      .values({ name: collidingName, category: "taste" });

    const seeds = parseSeedSakes([
      {
        name: "カテゴリ衝突検証銘柄",
        brewery: "カテゴリ衝突酒造",
        prefectureCode: "13",
        reading: "かてごりしょうとつけんしょうめいがら",
        description: "種別語が既存の味タグと同名のケースを検証する自作説明文。",
        typeTags: [collidingName],
      },
    ]);

    // 味タグ ID を種別として黙って流用せず、明示的に停止する
    await expect(seedSakes(orm, seeds)).rejects.toThrow(/衝突検証味タグ/);
  });
});
