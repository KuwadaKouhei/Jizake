import { z } from "zod";

/**
 * さけのわ API レスポンスの Zod スキーマ（境界での実行時検証）。
 *
 * 構造は docs/SAKENOWA_API.md §3 の実測結果を単一情報源とする。
 * 検証はインポートが依存するフィールドのみに絞り、未知のフィールドは
 * 素通しする（API 側の追加変更で壊れないように。仕様変更の検知は
 * 「依存フィールドが消えた／型が変わった」時点でパースエラーとして現れる）。
 */

// /areas — id 1〜47 は JIS 都道府県コードと一致。id 0「その他」が存在する
export const areasResponseSchema = z.object({
  areas: z.array(
    z.object({
      id: z.number().int().nonnegative(),
      name: z.string().min(1),
    }),
  ),
});
export type AreasResponse = z.infer<typeof areasResponseSchema>;

// /breweries — areaId → breweries.prefecture_code の供給源。
// name は空文字を許容する（実データに県別プレースホルダとみられる空文字名の
// 蔵元が存在する。docs/SAKENOWA_API.md §3。スキップ判断はインポート側で行う）
export const breweriesResponseSchema = z.object({
  breweries: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      areaId: z.number().int().nonnegative(),
    }),
  ),
});
export type BreweriesResponse = z.infer<typeof breweriesResponseSchema>;
export type SakenowaBrewery = BreweriesResponse["breweries"][number];

// /brands — id が sakes.sakenowa_brand_id（冪等 upsert キー）
export const brandsResponseSchema = z.object({
  brands: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string().min(1),
      breweryId: z.number().int().positive(),
    }),
  ),
});
export type BrandsResponse = z.infer<typeof brandsResponseSchema>;
export type SakenowaBrand = BrandsResponse["brands"][number];

// /flavor-charts — 6軸（f1=華やか, f2=芳醇, f3=重厚, f4=穏やか, f5=ドライ, f6=軽快）。
// 正規化済み float（0..1）。全銘柄の 1/3 程度にしかデータがない
const flavorAxisSchema = z.number().min(0).max(1);
export const flavorChartsResponseSchema = z.object({
  flavorCharts: z.array(
    z.object({
      brandId: z.number().int().positive(),
      f1: flavorAxisSchema,
      f2: flavorAxisSchema,
      f3: flavorAxisSchema,
      f4: flavorAxisSchema,
      f5: flavorAxisSchema,
      f6: flavorAxisSchema,
    }),
  ),
});
export type FlavorChartsResponse = z.infer<typeof flavorChartsResponseSchema>;
export type SakenowaFlavorChart = FlavorChartsResponse["flavorCharts"][number];

// /flavor-tags — 味検索タグの語彙マスタ（242 種）
export const flavorTagsResponseSchema = z.object({
  tags: z.array(
    z.object({
      id: z.number().int().positive(),
      tag: z.string().min(1),
    }),
  ),
});
export type FlavorTagsResponse = z.infer<typeof flavorTagsResponseSchema>;

// /brand-flavor-tags — 銘柄→タグ ID 群（空配列の銘柄あり）
export const brandFlavorTagsResponseSchema = z.object({
  flavorTags: z.array(
    z.object({
      brandId: z.number().int().positive(),
      tagIds: z.array(z.number().int().positive()),
    }),
  ),
});
export type BrandFlavorTagsResponse = z.infer<
  typeof brandFlavorTagsResponseSchema
>;

// /rankings — 月次スナップショット。overall が popularity_rank の供給源
const rankingEntrySchema = z.object({
  rank: z.number().int().positive(),
  score: z.number(),
  brandId: z.number().int().positive(),
});
export const rankingsResponseSchema = z.object({
  yearMonth: z.string().regex(/^\d{6}$/),
  overall: z.array(rankingEntrySchema),
  areas: z.array(
    z.object({
      areaId: z.number().int().nonnegative(),
      ranking: z.array(rankingEntrySchema),
    }),
  ),
});
export type RankingsResponse = z.infer<typeof rankingsResponseSchema>;
