import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { closeDb, getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

import {
  fetchSakenowaSnapshot,
  type SakenowaSnapshot,
} from "./lib/sakenowa/client";
import { flavorToTagNames } from "./lib/sakenowa/flavor-to-tags";

/**
 * さけのわデータの冪等インポート（DESIGN §2.7・DATABASE.md §1.3）。
 *
 * - 競合キー: breweries.sakenowa_brewery_id / sakes.sakenowa_brand_id
 *   （ON CONFLICT DO UPDATE による冪等 upsert。再実行で同一状態になる）
 * - 手作業カラム（reading / description / official_url / amazon_url /
 *   rakuten_url / price_range）は更新対象に含めず、再インポートで上書きしない。
 * - sake_tags は source='sakenowa' の行のみ delete-insert で入れ替え、
 *   manual の行には触れない（DATABASE.md §2.4）。同一 (sake, tag) に manual が
 *   既にある場合は ON CONFLICT DO NOTHING で manual を優先する。
 * - スキップ規則（docs/SAKENOWA_API.md §3 の実測に基づく）:
 *   - areaId=0（その他）の蔵元とその銘柄（prefecture_code に写せない）
 *   - 空文字名の蔵元（プレースホルダ）とその銘柄
 *   - 同一 (name, prefecture_code) の重複蔵元は最初の 1 件に統合し、
 *     重複側の銘柄は統合先へ付け替える
 * - rankings（総合）から popularity_rank を反映する。今回のランキングに
 *   載っていない銘柄は NULL に戻す（月次スナップショットの洗い替え）。
 */

// PostgresJsDatabase（本番）と PgliteDatabase（テスト）の両方を受けるための共通型
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// 一括 INSERT の 1 チャンクあたり行数（postgres のパラメータ上限 65535 に対する余裕）
const UPSERT_CHUNK_SIZE = 1_000;

export type ImportSummary = {
  yearMonth: string;
  breweries: {
    upserted: number;
    skippedOtherArea: number;
    skippedEmptyName: number;
    mergedDuplicateName: number;
  };
  sakes: {
    upserted: number;
    skippedNoBrewery: number;
    skippedDuplicateName: number;
    withFlavorChart: number;
    withPopularityRank: number;
  };
  tags: { upserted: number; unknownTagIdRefs: number };
  sakeTags: { replaced: number };
};

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/** スナップショットを DB へ冪等 upsert する（1 トランザクション）。 */
export async function importSakenowaSnapshot(
  db: Db,
  snapshot: SakenowaSnapshot,
): Promise<ImportSummary> {
  return db.transaction(async (tx) => {
    // ------------------------------------------------------------------
    // 1) breweries: スキップ・重複統合を解決してから upsert
    // ------------------------------------------------------------------
    const breweryStats = {
      upserted: 0,
      skippedOtherArea: 0,
      skippedEmptyName: 0,
      mergedDuplicateName: 0,
    };
    // 重複 (name, prefecture_code) の統合先: さけのわ蔵元 ID → 統合先のさけのわ蔵元 ID
    const canonicalBreweryId = new Map<number, number>();
    const seenByNameAndPrefecture = new Map<string, number>();
    const breweryRows: (typeof schema.breweries.$inferInsert)[] = [];

    for (const brewery of snapshot.breweries.breweries) {
      const name = brewery.name.trim();
      if (name === "") {
        breweryStats.skippedEmptyName++;
        continue;
      }
      if (brewery.areaId < 1 || brewery.areaId > 47) {
        breweryStats.skippedOtherArea++;
        continue;
      }
      const prefectureCode = String(brewery.areaId).padStart(2, "0");
      const key = `${prefectureCode}:${name}`;
      const existing = seenByNameAndPrefecture.get(key);
      if (existing !== undefined) {
        canonicalBreweryId.set(brewery.id, existing);
        breweryStats.mergedDuplicateName++;
        continue;
      }
      seenByNameAndPrefecture.set(key, brewery.id);
      breweryRows.push({ sakenowaBreweryId: brewery.id, name, prefectureCode });
    }

    for (const rows of chunk(breweryRows, UPSERT_CHUNK_SIZE)) {
      await tx
        .insert(schema.breweries)
        .values(rows)
        .onConflictDoUpdate({
          target: schema.breweries.sakenowaBreweryId,
          set: {
            name: sql`excluded.name`,
            prefectureCode: sql`excluded.prefecture_code`,
            updatedAt: sql`now()`,
          },
        });
    }
    breweryStats.upserted = breweryRows.length;

    // さけのわ蔵元 ID → DB uuid の対応（upsert 後の実 ID を取得）
    const breweryIdRows = await tx
      .select({
        id: schema.breweries.id,
        sakenowaBreweryId: schema.breweries.sakenowaBreweryId,
      })
      .from(schema.breweries)
      .where(sql`${schema.breweries.sakenowaBreweryId} is not null`);
    const breweryUuidBySakenowaId = new Map<number, string>();
    for (const row of breweryIdRows) {
      if (row.sakenowaBreweryId !== null) {
        breweryUuidBySakenowaId.set(row.sakenowaBreweryId, row.id);
      }
    }

    // ------------------------------------------------------------------
    // 2) sakes: フレーバー 6 軸と popularity_rank を含めて upsert
    // ------------------------------------------------------------------
    const chartByBrandId = new Map(
      snapshot.flavorCharts.flavorCharts.map((chart) => [chart.brandId, chart]),
    );
    const rankByBrandId = new Map(
      snapshot.rankings.overall.map((entry) => [entry.brandId, entry.rank]),
    );

    const sakeStats = {
      upserted: 0,
      skippedNoBrewery: 0,
      skippedDuplicateName: 0,
      withFlavorChart: 0,
      withPopularityRank: 0,
    };
    const seenByBreweryAndName = new Set<string>();
    const sakeRows: (typeof schema.sakes.$inferInsert)[] = [];

    for (const brand of snapshot.brands.brands) {
      const sakenowaBreweryId =
        canonicalBreweryId.get(brand.breweryId) ?? brand.breweryId;
      const breweryId = breweryUuidBySakenowaId.get(sakenowaBreweryId);
      if (breweryId === undefined) {
        // スキップした蔵元（areaId=0・空文字名）に属する銘柄
        sakeStats.skippedNoBrewery++;
        continue;
      }
      const key = `${breweryId}:${brand.name}`;
      if (seenByBreweryAndName.has(key)) {
        // UNIQUE (brewery_id, name) に抵触する重複銘柄（蔵元統合で発生し得る）
        sakeStats.skippedDuplicateName++;
        continue;
      }
      seenByBreweryAndName.add(key);

      const chart = chartByBrandId.get(brand.id);
      const rank = rankByBrandId.get(brand.id) ?? null;
      if (chart) sakeStats.withFlavorChart++;
      if (rank !== null) sakeStats.withPopularityRank++;

      sakeRows.push({
        sakenowaBrandId: brand.id,
        breweryId,
        name: brand.name,
        popularityRank: rank,
        flavorFloral: chart?.f1 ?? null,
        flavorMellow: chart?.f2 ?? null,
        flavorHeavy: chart?.f3 ?? null,
        flavorMild: chart?.f4 ?? null,
        flavorDry: chart?.f5 ?? null,
        flavorLight: chart?.f6 ?? null,
      });
    }

    for (const rows of chunk(sakeRows, UPSERT_CHUNK_SIZE)) {
      await tx
        .insert(schema.sakes)
        .values(rows)
        .onConflictDoUpdate({
          target: schema.sakes.sakenowaBrandId,
          // 手作業カラム（reading / description / 各 URL / price_range）は
          // 更新しない（再インポートで手作業データを上書きしない）
          set: {
            name: sql`excluded.name`,
            breweryId: sql`excluded.brewery_id`,
            popularityRank: sql`excluded.popularity_rank`,
            flavorFloral: sql`excluded.flavor_floral`,
            flavorMellow: sql`excluded.flavor_mellow`,
            flavorHeavy: sql`excluded.flavor_heavy`,
            flavorMild: sql`excluded.flavor_mild`,
            flavorDry: sql`excluded.flavor_dry`,
            flavorLight: sql`excluded.flavor_light`,
            updatedAt: sql`now()`,
          },
        });
    }
    sakeStats.upserted = sakeRows.length;

    // さけのわ銘柄 ID → DB uuid の対応
    const sakeIdRows = await tx
      .select({
        id: schema.sakes.id,
        sakenowaBrandId: schema.sakes.sakenowaBrandId,
      })
      .from(schema.sakes)
      .where(sql`${schema.sakes.sakenowaBrandId} is not null`);
    const sakeUuidByBrandId = new Map<number, string>();
    for (const row of sakeIdRows) {
      if (row.sakenowaBrandId !== null) {
        sakeUuidByBrandId.set(row.sakenowaBrandId, row.id);
      }
    }

    // ------------------------------------------------------------------
    // 3) tags: 実際に付与されるタグ名だけを upsert（未使用語彙は入れない）
    // ------------------------------------------------------------------
    const tagNameById = new Map(
      snapshot.flavorTags.tags.map((tag) => [tag.id, tag.tag]),
    );

    let unknownTagIdRefs = 0;
    // 銘柄ごとの付与タグ名（さけのわ付与タグ ∪ フレーバー 6 軸からの機械変換）
    const tagNamesBySakeId = new Map<string, Set<string>>();
    const addTag = (sakeId: string, tagName: string) => {
      const names = tagNamesBySakeId.get(sakeId) ?? new Set<string>();
      names.add(tagName);
      tagNamesBySakeId.set(sakeId, names);
    };

    for (const entry of snapshot.brandFlavorTags.flavorTags) {
      const sakeId = sakeUuidByBrandId.get(entry.brandId);
      if (sakeId === undefined) continue; // スキップした銘柄
      for (const tagId of entry.tagIds) {
        const tagName = tagNameById.get(tagId);
        if (tagName === undefined) {
          // タグマスタに無い ID の参照（API 側の不整合）。落とさず件数だけ記録
          unknownTagIdRefs++;
          continue;
        }
        addTag(sakeId, tagName);
      }
    }
    for (const chart of snapshot.flavorCharts.flavorCharts) {
      const sakeId = sakeUuidByBrandId.get(chart.brandId);
      if (sakeId === undefined) continue;
      for (const tagName of flavorToTagNames(chart)) {
        addTag(sakeId, tagName);
      }
    }

    const usedTagNames = [
      ...new Set([...tagNamesBySakeId.values()].flatMap((names) => [...names])),
    ];
    for (const rows of chunk(
      usedTagNames.map((name) => ({ name, category: "taste" })),
      UPSERT_CHUNK_SIZE,
    )) {
      // 既存タグ（手作業付与含む）は名前で解決し、上書きしない
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
    // 4) sake_tags: source='sakenowa' のみ入れ替え（manual は保全）
    // ------------------------------------------------------------------
    await tx
      .delete(schema.sakeTags)
      .where(sql`${schema.sakeTags.source} = 'sakenowa'`);

    const sakeTagRows: (typeof schema.sakeTags.$inferInsert)[] = [];
    for (const [sakeId, names] of tagNamesBySakeId) {
      for (const name of names) {
        const tagId = tagIdByName.get(name);
        if (tagId === undefined) continue; // usedTagNames 由来のため通常発生しない
        sakeTagRows.push({ sakeId, tagId, source: "sakenowa" });
      }
    }
    for (const rows of chunk(sakeTagRows, UPSERT_CHUNK_SIZE)) {
      // 同一 (sake, tag) に manual 行が既にある場合は挿入せず manual を優先する
      await tx.insert(schema.sakeTags).values(rows).onConflictDoNothing();
    }

    return {
      yearMonth: snapshot.rankings.yearMonth,
      breweries: breweryStats,
      sakes: sakeStats,
      tags: { upserted: usedTagNames.length, unknownTagIdRefs },
      sakeTags: { replaced: sakeTagRows.length },
    };
  });
}

function logSummary(summary: ImportSummary): void {
  console.log(
    `さけのわデータのインポートが完了しました（ランキング年月: ${summary.yearMonth}）`,
  );
  console.log(
    `  蔵元: upsert ${summary.breweries.upserted} 件 / スキップ: その他地域(areaId=0等) ${summary.breweries.skippedOtherArea} 件・空文字名 ${summary.breweries.skippedEmptyName} 件 / 同名統合 ${summary.breweries.mergedDuplicateName} 件`,
  );
  console.log(
    `  銘柄: upsert ${summary.sakes.upserted} 件（フレーバーあり ${summary.sakes.withFlavorChart} 件・ランキング反映 ${summary.sakes.withPopularityRank} 件） / スキップ: 蔵元なし ${summary.sakes.skippedNoBrewery} 件・重複名 ${summary.sakes.skippedDuplicateName} 件`,
  );
  console.log(
    `  タグ: ${summary.tags.upserted} 種 / タグ付け ${summary.sakeTags.replaced} 件（source='sakenowa' を入れ替え。manual は保全）`,
  );
  if (summary.tags.unknownTagIdRefs > 0) {
    console.warn(
      `  警告: タグマスタに存在しない tagId への参照を ${summary.tags.unknownTagIdRefs} 件スキップしました`,
    );
  }
}

async function main(): Promise<void> {
  // drizzle.config.ts と同じ規約（.env.local 等）で DATABASE_URL を読む
  loadEnvConfig(process.cwd());
  // DATABASE_URL 未設定ならここで明確に失敗させる（API を無駄に叩かない）
  const db = getDb();
  console.log("さけのわ API からデータを取得しています…");
  const snapshot = await fetchSakenowaSnapshot();
  const summary = await importSakenowaSnapshot(db, snapshot);
  logSummary(summary);
}

// テストから importSakenowaSnapshot を import しても実行されないよう、
// 直接実行（npm run import:sakenowa）のときだけ main を起動する
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main()
    .catch((error: unknown) => {
      console.error("インポートに失敗しました:", error);
      process.exitCode = 1;
    })
    .finally(() => closeDb()); // 接続プールを必ず閉じる（プロセス残留防止）
}
