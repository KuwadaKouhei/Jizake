import type { z } from "zod";

import {
  areasResponseSchema,
  brandFlavorTagsResponseSchema,
  brandsResponseSchema,
  breweriesResponseSchema,
  flavorChartsResponseSchema,
  flavorTagsResponseSchema,
  rankingsResponseSchema,
  type AreasResponse,
  type BrandFlavorTagsResponse,
  type BrandsResponse,
  type BreweriesResponse,
  type FlavorChartsResponse,
  type FlavorTagsResponse,
  type RankingsResponse,
} from "./schemas";

/**
 * さけのわ API クライアント（docs/SAKENOWA_API.md）。
 *
 * - 認証不要の公開 API（帰属表示のみが利用条件）。
 * - 全エンドポイントは一括取得型（ページネーションなし）。7 リクエストで
 *   全データが揃うため、リクエスト間に軽い sleep を入れる（レート制限は
 *   公表されていないが、常識的な頻度に抑える）。
 */

const BASE_URL = "https://muro.sakenowa.com/sakenowa-data/api";

// リクエスト間の待機（低頻度アクセスのマナー。7 リクエストのみなので十分短くてよい）
const REQUEST_INTERVAL_MS = 1_000;

const REQUEST_TIMEOUT_MS = 30_000;

// 利用元を明示する（問い合わせ先: support@sakenowa.com への礼儀として）
const USER_AGENT =
  "jizake-import-batch/0.1 (+https://github.com/KuwadaKouhei/Jizake)";

/** 全 7 エンドポイントのスナップショット（Zod 検証済み） */
export type SakenowaSnapshot = {
  areas: AreasResponse;
  breweries: BreweriesResponse;
  brands: BrandsResponse;
  flavorCharts: FlavorChartsResponse;
  flavorTags: FlavorTagsResponse;
  brandFlavorTags: BrandFlavorTagsResponse;
  rankings: RankingsResponse;
};

async function fetchEndpoint<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const url = `${BASE_URL}/${path}`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `さけのわ API の取得に失敗しました: GET ${url} → ${response.status} ${response.statusText}`,
    );
  }
  // Zod パース失敗（= API 仕様変更）はそのまま上位へ投げ、早期に検知する
  return schema.parse(await response.json());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 全エンドポイントを直列に取得する（docs/SAKENOWA_API.md §5 の取得順）。
 * 失敗時は途中で例外を投げる（部分結果を返さない）。
 */
export async function fetchSakenowaSnapshot(): Promise<SakenowaSnapshot> {
  const areas = await fetchEndpoint("areas", areasResponseSchema);
  await sleep(REQUEST_INTERVAL_MS);
  const breweries = await fetchEndpoint("breweries", breweriesResponseSchema);
  await sleep(REQUEST_INTERVAL_MS);
  const brands = await fetchEndpoint("brands", brandsResponseSchema);
  await sleep(REQUEST_INTERVAL_MS);
  const flavorCharts = await fetchEndpoint(
    "flavor-charts",
    flavorChartsResponseSchema,
  );
  await sleep(REQUEST_INTERVAL_MS);
  const flavorTags = await fetchEndpoint(
    "flavor-tags",
    flavorTagsResponseSchema,
  );
  await sleep(REQUEST_INTERVAL_MS);
  const brandFlavorTags = await fetchEndpoint(
    "brand-flavor-tags",
    brandFlavorTagsResponseSchema,
  );
  await sleep(REQUEST_INTERVAL_MS);
  const rankings = await fetchEndpoint("rankings", rankingsResponseSchema);

  return {
    areas,
    breweries,
    brands,
    flavorCharts,
    flavorTags,
    brandFlavorTags,
    rankings,
  };
}
