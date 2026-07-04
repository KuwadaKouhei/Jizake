import { asc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { cache } from "react";

import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { breweries, sakeTags, sakes, tags } from "@/lib/db/schema";

/**
 * カタログ（日本酒）の横断読み取りクエリ。
 *
 * 詳細ページ（/sake/[id]）だけでなく、以降の一覧・検索・推薦・チャット提案でも
 * 銘柄の要約表示を共用するため、共有クエリとして src/lib/db/queries に置く
 * （DIRECTORY_STRUCTURE §3・DIR-6: 複数機能から使う読み取りのみをここに置く）。
 *
 * 依存方向（DIRECTORY_STRUCTURE §5.2）: データアクセス層のため UI の型を知らない。
 * ここでは Drizzle スキーマから導出したアプリ内型のみを返す。
 */

/** タグ 1 件の表示用要約（カテゴリで種別/味わいを出し分けるために保持）。 */
export type SakeTagSummary = {
  id: string;
  name: string;
  category: string;
  /** 付与元。'sakenowa'（機械付与）/ 'manual'（手作業） */
  source: string;
};

/** フレーバー 6 軸（0..1）。DB 上は「全部ある」か「全部ない」のどちらか。 */
export type FlavorChart = {
  floral: number;
  mellow: number;
  heavy: number;
  mild: number;
  dry: number;
  light: number;
};

/**
 * カード等で使う銘柄の要約。一覧・検索・推薦・チャット提案で共用する
 * （sake-card.tsx が受け取る単位）。
 */
export type SakeSummary = {
  id: string;
  name: string;
  /** 蔵元名（breweries.name）。信頼できない外部入力としてテキスト表示する */
  breweryName: string;
  prefectureCode: string;
  /** 主要タグ（要約表示用。詳細は SakeDetail.tags を使う） */
  tags: SakeTagSummary[];
};

/**
 * 詳細ページ用の全項目。SakeSummary を拡張し、説明文・外部リンク・価格帯・
 * フレーバーを加える。NULL 可カラムはそのまま null で返し、表示側で
 * 「無い場合は非表示」を判断する（FR-03）。
 */
export type SakeDetail = SakeSummary & {
  reading: string | null;
  description: string | null;
  officialUrl: string | null;
  amazonUrl: string | null;
  rakutenUrl: string | null;
  priceRange: string | null;
  flavor: FlavorChart | null;
};

// UUID v4 の書式（DATABASE.md §1.3: 全 PK は gen_random_uuid() = v4）。
// version ニブル（4）と variant ニブル（8/9/a/b）まで固定して v4 に限定する。
// 不正な id は DB へ問い合わせる前に弾き、notFound() に落とす（T05 ⑤）。
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** id が UUID の書式かを判定する（URL パラメータの境界検証）。 */
export function isValidSakeId(id: string): boolean {
  return UUID_PATTERN.test(id);
}

/** 6 軸のいずれかが null なら（=全 null）フレーバー無しとして null を返す。 */
function toFlavorChart(row: {
  flavorFloral: number | null;
  flavorMellow: number | null;
  flavorHeavy: number | null;
  flavorMild: number | null;
  flavorDry: number | null;
  flavorLight: number | null;
}): FlavorChart | null {
  if (
    row.flavorFloral === null ||
    row.flavorMellow === null ||
    row.flavorHeavy === null ||
    row.flavorMild === null ||
    row.flavorDry === null ||
    row.flavorLight === null
  ) {
    return null;
  }
  return {
    floral: row.flavorFloral,
    mellow: row.flavorMellow,
    heavy: row.flavorHeavy,
    mild: row.flavorMild,
    dry: row.flavorDry,
    light: row.flavorLight,
  };
}

// PostgresJsDatabase（本番）と PgliteDatabase（テスト）の両方を受ける共通型
// （scripts/seed.ts と同型。テストで PGlite を差し込むため）。
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** 銘柄に紐づくタグを取得する（category → name の安定順）。 */
async function selectSakeTags(
  db: Db,
  sakeId: string,
): Promise<SakeTagSummary[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      category: tags.category,
      source: sakeTags.source,
    })
    .from(sakeTags)
    .innerJoin(tags, eq(tags.id, sakeTags.tagId))
    .where(eq(sakeTags.sakeId, sakeId))
    .orderBy(asc(tags.category), asc(tags.name));
  return rows;
}

/**
 * 詳細ページ用に、銘柄＋蔵元＋タグを取得する（db を明示的に受ける下位関数）。
 * テストでは PGlite を差し込むためにこちらを直接呼ぶ。
 */
export async function selectSakeDetail(
  db: Db,
  id: string,
): Promise<SakeDetail | null> {
  if (!isValidSakeId(id)) {
    return null;
  }

  const [row] = await db
    .select({
      id: sakes.id,
      name: sakes.name,
      reading: sakes.reading,
      description: sakes.description,
      officialUrl: sakes.officialUrl,
      amazonUrl: sakes.amazonUrl,
      rakutenUrl: sakes.rakutenUrl,
      priceRange: sakes.priceRange,
      breweryName: breweries.name,
      prefectureCode: breweries.prefectureCode,
      flavorFloral: sakes.flavorFloral,
      flavorMellow: sakes.flavorMellow,
      flavorHeavy: sakes.flavorHeavy,
      flavorMild: sakes.flavorMild,
      flavorDry: sakes.flavorDry,
      flavorLight: sakes.flavorLight,
    })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(eq(sakes.id, id))
    .limit(1);

  if (!row) {
    return null;
  }

  const tagRows = await selectSakeTags(db, row.id);

  return {
    id: row.id,
    name: row.name,
    breweryName: row.breweryName,
    prefectureCode: row.prefectureCode,
    tags: tagRows,
    reading: row.reading,
    description: row.description,
    officialUrl: row.officialUrl,
    amazonUrl: row.amazonUrl,
    rakutenUrl: row.rakutenUrl,
    priceRange: row.priceRange,
    flavor: toFlavorChart(row),
  };
}

/**
 * 詳細ページ用に、銘柄＋蔵元＋タグを取得する（RSC から直接呼ぶ公開関数）。
 *
 * - id が UUID 書式でない、または該当銘柄が無い場合は null を返す
 *   （呼び出し側の RSC が notFound() に変換する。T05 ⑤）。
 * - 蔵元は INNER JOIN（brewery_id は NOT NULL）。
 * - React.cache でラップし、同一リクエスト内の重複呼び出し（generateMetadata と
 *   本体レンダリング）で DB クエリが二重に走らないようメモ化する。
 */
export const getSakeDetail = cache((id: string): Promise<SakeDetail | null> =>
  selectSakeDetail(getDb(), id),
);
