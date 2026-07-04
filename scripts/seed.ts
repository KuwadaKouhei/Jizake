import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { SEED_SAKES } from "../seed-data/sakes";
import { closeDb, getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

import { parseSeedSakes, type SeedSake } from "./lib/seed/schema";

/**
 * 手作業シードデータの冪等投入（DESIGN §2.7・DATABASE.md §1.3）。
 *
 * - 競合キー:
 *   - breweries: UNIQUE (name, prefecture_code)
 *   - sakes:     UNIQUE (brewery_id, name)
 *   - tags:      UNIQUE (name)（種別タグ。category='type'）
 *   - sake_tags: PRIMARY KEY (sake_id, tag_id)、source='manual'
 *   いずれも ON CONFLICT DO UPDATE / DO NOTHING による冪等 upsert（再実行で同一状態）。
 *
 * - さけのわ由来データとの共存（DATABASE.md §2.4・T03 レビュー引き継ぎ）:
 *   - breweries: (name, prefecture_code) が一致すれば既存の さけのわ蔵元 行を再利用し、
 *     sakenowa_brewery_id 等の さけのわ由来カラムは上書きしない（手作業カラムだけを付与）。
 *   - sakes: (brewery_id, name) が一致する既存 さけのわ銘柄 には手作業カラム
 *     （reading / description / official_url / amazon_url / price_range）を付与するが、
 *     さけのわ由来カラム（sakenowa_brand_id / popularity_rank / flavor_* 等）は上書きしない。
 *   - sake_tags: source='manual' のみを扱い、source='sakenowa' の行には触れない。
 *
 * - name は信頼できない外部入力として扱わないが（自作データ）、境界スキーマ
 *   （scripts/lib/seed/schema.ts）で必須項目・都道府県コード・price_range・重複を検証する。
 */

// PostgresJsDatabase（本番）と PgliteDatabase（テスト）の両方を受けるための共通型
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// 一括 INSERT の 1 チャンクあたり行数（postgres のパラメータ上限に対する余裕）
const UPSERT_CHUNK_SIZE = 1_000;

export type SeedSummary = {
  breweries: { upserted: number };
  sakes: { upserted: number };
  tags: { upserted: number };
  sakeTags: { attached: number };
};

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/** 検証済みシードを DB へ冪等 upsert する（1 トランザクション）。 */
export async function seedSakes(
  db: Db,
  seeds: readonly SeedSake[],
): Promise<SeedSummary> {
  return db.transaction(async (tx) => {
    // ------------------------------------------------------------------
    // 1) breweries: UNIQUE (name, prefecture_code) を競合キーに upsert。
    //    さけのわ由来カラム（sakenowa_brewery_id）は上書きしない。
    // ------------------------------------------------------------------
    type BreweryKey = string; // `${prefectureCode}:${name}`
    const breweryKey = (name: string, prefectureCode: string): BreweryKey =>
      `${prefectureCode}:${name}`;

    const uniqueBreweries = new Map<
      BreweryKey,
      { name: string; prefectureCode: string }
    >();
    for (const seed of seeds) {
      const key = breweryKey(seed.brewery, seed.prefectureCode);
      if (!uniqueBreweries.has(key)) {
        uniqueBreweries.set(key, {
          name: seed.brewery,
          prefectureCode: seed.prefectureCode,
        });
      }
    }

    const breweryRows = [...uniqueBreweries.values()];
    for (const rows of chunk(breweryRows, UPSERT_CHUNK_SIZE)) {
      await tx
        .insert(schema.breweries)
        .values(rows)
        .onConflictDoUpdate({
          target: [schema.breweries.name, schema.breweries.prefectureCode],
          // 一致行は更新点がない（name・prefecture_code は競合キー）が、
          // ON CONFLICT DO NOTHING では RETURNING が返らず解決が煩雑になるため、
          // updated_at のみ更新する no-op 相当の upsert にする。
          // さけのわ由来カラム（sakenowa_brewery_id）は set に含めず保全する。
          set: { updatedAt: sql`now()` },
        });
    }

    // (name, prefecture_code) → DB uuid の対応（upsert 後の実 ID を取得）
    const breweryIdRows = await tx
      .select({
        id: schema.breweries.id,
        name: schema.breweries.name,
        prefectureCode: schema.breweries.prefectureCode,
      })
      .from(schema.breweries);
    const breweryUuidByKey = new Map<BreweryKey, string>(
      breweryIdRows.map((row) => [
        breweryKey(row.name, row.prefectureCode),
        row.id,
      ]),
    );

    // ------------------------------------------------------------------
    // 2) sakes: UNIQUE (brewery_id, name) を競合キーに upsert。
    //    手作業カラムのみ set し、さけのわ由来カラムは上書きしない。
    // ------------------------------------------------------------------
    const sakeRows: (typeof schema.sakes.$inferInsert)[] = [];
    // seed → 解決済み breweryId（タグ付与で銘柄 uuid を引くのに再利用）
    const seedBreweryIds: string[] = [];
    for (const seed of seeds) {
      const breweryId = breweryUuidByKey.get(
        breweryKey(seed.brewery, seed.prefectureCode),
      );
      if (breweryId === undefined) {
        // breweryRows を必ず先に upsert しているため通常発生しない
        throw new Error(
          `蔵元 uuid を解決できません（${seed.brewery} / ${seed.prefectureCode}）`,
        );
      }
      seedBreweryIds.push(breweryId);
      sakeRows.push({
        breweryId,
        name: seed.name,
        reading: seed.reading,
        description: seed.description,
        officialUrl: seed.officialUrl ?? null,
        amazonUrl: seed.amazonUrl ?? null,
        priceRange: seed.priceRange ?? null,
      });
    }

    for (const rows of chunk(sakeRows, UPSERT_CHUNK_SIZE)) {
      await tx
        .insert(schema.sakes)
        .values(rows)
        .onConflictDoUpdate({
          target: [schema.sakes.breweryId, schema.sakes.name],
          // 手作業カラムのみ更新（さけのわ由来カラムは保全）。
          set: {
            reading: sql`excluded.reading`,
            description: sql`excluded.description`,
            officialUrl: sql`excluded.official_url`,
            amazonUrl: sql`excluded.amazon_url`,
            priceRange: sql`excluded.price_range`,
            updatedAt: sql`now()`,
          },
        });
    }

    // (brewery_id, name) → DB uuid の対応（さけのわ銘柄含む全銘柄から引く）
    const sakeIdRows = await tx
      .select({
        id: schema.sakes.id,
        breweryId: schema.sakes.breweryId,
        name: schema.sakes.name,
      })
      .from(schema.sakes);
    const sakeUuidByKey = new Map<string, string>(
      sakeIdRows.map((row) => [`${row.breweryId}:${row.name}`, row.id]),
    );

    // seed の並び順どおりに、各銘柄の uuid と種別タグ名を対応づける
    const typeTagNamesBySakeId = new Map<string, Set<string>>();
    seeds.forEach((seed, index) => {
      const sakeId = sakeUuidByKey.get(`${seedBreweryIds[index]}:${seed.name}`);
      if (sakeId === undefined) {
        throw new Error(`銘柄 uuid を解決できません（${seed.name}）`);
      }
      const names = typeTagNamesBySakeId.get(sakeId) ?? new Set<string>();
      for (const tagName of seed.typeTags) names.add(tagName);
      typeTagNamesBySakeId.set(sakeId, names);
    });

    // ------------------------------------------------------------------
    // 3) tags: 種別タグ（category='type'）を name 競合で upsert。
    //    既存タグ（さけのわ由来の taste タグ等）は上書きしない。
    // ------------------------------------------------------------------
    const usedTagNames = [
      ...new Set(
        [...typeTagNamesBySakeId.values()].flatMap((names) => [...names]),
      ),
    ];
    for (const rows of chunk(
      usedTagNames.map((name) => ({ name, category: "type" })),
      UPSERT_CHUNK_SIZE,
    )) {
      await tx
        .insert(schema.tags)
        .values(rows)
        .onConflictDoNothing({ target: schema.tags.name });
    }

    const tagRows = await tx
      .select({ id: schema.tags.id, name: schema.tags.name })
      .from(schema.tags);
    const tagIdByName = new Map(tagRows.map((tag) => [tag.name, tag.id]));

    // ------------------------------------------------------------------
    // 4) sake_tags: source='manual' で付与。source='sakenowa' の行には触れない。
    //    シード対象銘柄の manual 行のみ入れ替え、シードから外れた種別タグを掃除する。
    // ------------------------------------------------------------------
    const seededSakeIds = [...typeTagNamesBySakeId.keys()];
    for (const ids of chunk(seededSakeIds, UPSERT_CHUNK_SIZE)) {
      await tx
        .delete(schema.sakeTags)
        .where(
          and(
            eq(schema.sakeTags.source, "manual"),
            inArray(schema.sakeTags.sakeId, ids),
          ),
        );
    }

    const sakeTagRows: (typeof schema.sakeTags.$inferInsert)[] = [];
    for (const [sakeId, names] of typeTagNamesBySakeId) {
      for (const name of names) {
        const tagId = tagIdByName.get(name);
        if (tagId === undefined) continue; // usedTagNames 由来のため通常発生しない
        sakeTagRows.push({ sakeId, tagId, source: "manual" });
      }
    }
    for (const rows of chunk(sakeTagRows, UPSERT_CHUNK_SIZE)) {
      // 同一 (sake, tag) に source='sakenowa' 行が既にある場合は挿入せず既存を優先する
      // （複合 PK の衝突。手作業種別タグと機械タグが偶然同名になっても壊れない）
      await tx.insert(schema.sakeTags).values(rows).onConflictDoNothing();
    }

    return {
      breweries: { upserted: breweryRows.length },
      sakes: { upserted: sakeRows.length },
      tags: { upserted: usedTagNames.length },
      sakeTags: { attached: sakeTagRows.length },
    };
  });
}

function logSummary(summary: SeedSummary): void {
  console.log("手作業シードデータの投入が完了しました");
  console.log(`  蔵元: upsert ${summary.breweries.upserted} 件`);
  console.log(`  銘柄: upsert ${summary.sakes.upserted} 件`);
  console.log(
    `  種別タグ: ${summary.tags.upserted} 種 / タグ付け ${summary.sakeTags.attached} 件（source='manual'）`,
  );
}

async function main(): Promise<void> {
  // drizzle.config.ts と同じ規約（.env.local 等）で DATABASE_URL を読む
  loadEnvConfig(process.cwd());
  // DATABASE_URL 未設定ならここで明確に失敗させる
  const db = getDb();
  // 境界スキーマで検証してから投入する（不正データは早期に失敗させる）
  const seeds = parseSeedSakes(SEED_SAKES);
  console.log(`シードデータを検証しました（${seeds.length} 銘柄）`);
  const summary = await seedSakes(db, seeds);
  logSummary(summary);
}

// テストから seedSakes を import しても実行されないよう、
// 直接実行（npm run seed）のときだけ main を起動する
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  void (async () => {
    try {
      await main();
    } catch (error) {
      console.error("シード投入に失敗しました:", error);
      process.exitCode = 1;
    } finally {
      // 接続プールを必ず閉じる（プロセス残留防止）
      await closeDb();
    }
  })();
}
