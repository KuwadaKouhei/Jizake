import { z } from "zod";

import { PREFECTURES } from "@/lib/constants/prefectures";
import {
  PRICE_RANGES,
  type PriceRangeValue,
} from "@/lib/constants/price-ranges";

/**
 * 手作業シードデータ（seed-data/sakes.ts）の境界スキーマ（検証・型）。
 *
 * seed.ts の投入時と妥当性テストの両方でこのスキーマを通す（検証を一箇所に集約）。
 * seed-data/ は「データのみ」を置く方針のため（DIRECTORY_STRUCTURE §3）、検証ロジックは
 * さけのわ（scripts/lib/sakenowa/schemas.ts）と同型でこちらに置く。
 *
 * 説明文は必ず自作すること（他サイトからの転載禁止＝著作権 R2。FEASIBILITY R2）。
 * DATABASE.md §2 の物理制約（都道府県コード 01..47・price_range の CHECK 値・
 * NOT NULL 項目）を Zod でも表現し、投入前に検証エラーとして早期に落とす。
 */

// 都道府県コード集合（JIS 47 件。src/lib/constants/prefectures.ts を単一情報源に）
const PREFECTURE_CODES = new Set(PREFECTURES.map((p) => p.code));
// price_range の許容値（DATABASE.md CHECK と一致。src/lib/constants を単一情報源に）
const PRICE_RANGE_VALUES = new Set<string>(PRICE_RANGES.map((r) => r.value));

// 名前・説明の長さ上限（DB は text だが、手作業データの妥当性の目安として設ける）
const MAX_NAME_LENGTH = 200;
const MAX_READING_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2_000;

const trimmedNonEmpty = (max: number) => z.string().trim().min(1).max(max);

// 外部リンクは https のみ許可する。z.url() 単体は javascript:/data:/file: 等の
// 危険スキームを素通しするため、プロトコルを明示的に絞る（後続タスクでの
// <a href> 無検証描画による格納型 XSS を境界で防ぐ）。
const httpsUrl = z.url({ protocol: /^https$/ });

// 種別タグ（category='type'）。純米/純米吟醸/大吟醸 等
const typeTagName = trimmedNonEmpty(MAX_NAME_LENGTH);

export const seedSakeSchema = z.object({
  // 銘柄名（必須）
  name: trimmedNonEmpty(MAX_NAME_LENGTH),
  // 蔵元名（必須）。breweries.name として (name, prefecture_code) で upsert
  brewery: trimmedNonEmpty(MAX_NAME_LENGTH),
  // JIS 都道府県コード 2 桁（01..47）
  prefectureCode: z.string().refine((code) => PREFECTURE_CODES.has(code), {
    message:
      "prefectureCode は JIS 都道府県コード（01..47）のいずれかにすること",
  }),
  // 読み仮名（ひらがな）。ILIKE 検索の表記ゆれ対策（必須で整備する）
  reading: trimmedNonEmpty(MAX_READING_LENGTH).regex(/^[ぁ-んー・\s]+$/, {
    message: "reading はひらがな（と長音・中黒・空白）で表記すること",
  }),
  // 自作説明文（必須・空不可）。著作権上さけのわからは取得できない
  description: trimmedNonEmpty(MAX_DESCRIPTION_LENGTH),
  // 種別タグ（category='type'）。1 つ以上・重複なし
  typeTags: z
    .array(typeTagName)
    .min(1)
    .refine((tags) => new Set(tags).size === tags.length, {
      message: "typeTags に重複があります",
    }),
  // 価格帯区分（DATABASE.md CHECK と一致）。任意（ベストエフォート項目）
  priceRange: z
    .custom<PriceRangeValue>(
      (v) => typeof v === "string" && PRICE_RANGE_VALUES.has(v),
      {
        message: "priceRange は price-ranges.ts の value のいずれかにすること",
      },
    )
    .optional(),
  // 公式紹介ページ URL。任意。https のみ許可
  officialUrl: httpsUrl.optional(),
  // Amazon 購入リンク。任意（無い場合は詳細ページ側で検索 URL を生成する設計）。https のみ許可
  amazonUrl: httpsUrl.optional(),
});

export type SeedSake = z.infer<typeof seedSakeSchema>;

/**
 * シード配列全体のスキーマ。個々の銘柄検証に加え、集合レベルの一意性
 * （同一蔵元内の銘柄名重複＝UNIQUE(brewery_id, name) 違反の事前検知）を検証する。
 */
export const seedSakesSchema = z
  .array(seedSakeSchema)
  .min(1)
  .superRefine((sakes, ctx) => {
    // (蔵元名, 都道府県, 銘柄名) の一意性。同一蔵元内の同名銘柄は upsert キー衝突
    const seen = new Set<string>();
    for (const [index, sake] of sakes.entries()) {
      const key = `${sake.prefectureCode}:${sake.brewery}:${sake.name}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `銘柄が重複しています（蔵元「${sake.brewery}」の「${sake.name}」）`,
          path: [index, "name"],
        });
      }
      seen.add(key);
    }
  });

/** seed-data の生データを検証してパースする（不正なら例外）。 */
export function parseSeedSakes(raw: unknown): SeedSake[] {
  return seedSakesSchema.parse(raw);
}
