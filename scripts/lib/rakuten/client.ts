import type { RakutenItemCandidate } from "./match";

/**
 * 楽天市場 商品検索 API（Ichiba Item Search）クライアント。
 *
 * - エンドポイントは 2026 年 API 移行後の openapi.rakuten.co.jp（FEASIBILITY §2.2 追記）。
 *   認証は applicationId（クエリ）＋ accessKey。
 * - 日本酒ジャンル（genreId=100337）に絞り、formatVersion=2 で取得する。
 * - レート制限: 呼び出し側が 1 リクエスト/秒を守る。429 は 1 回だけ待って再試行する。
 */

const ENDPOINT =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

// 楽天ジャンル「日本酒」（FEASIBILITY §2.2 追記の裏取り値）
const SAKE_GENRE_ID = "100337";

// 1 銘柄あたりの取得候補数（照合はローカルで行うため上位のみで十分）
const HITS_PER_QUERY = 10;

// 429 時の待機ミリ秒（1 回だけ再試行）
const RETRY_WAIT_MS = 5_000;

export type RakutenCredentials = {
  applicationId: string;
  accessKey: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** formatVersion 1/2 どちらの形でも商品配列を candidate に正規化する（防御的）。 */
function toCandidates(payload: unknown): RakutenItemCandidate[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const items = (payload as { Items?: unknown }).Items;
  if (!Array.isArray(items)) {
    return [];
  }
  const candidates: RakutenItemCandidate[] = [];
  for (const entry of items) {
    // v1 は { Item: {...} } のラッパー付き、v2 はフラット
    const item =
      typeof entry === "object" && entry !== null && "Item" in entry
        ? (entry as { Item: unknown }).Item
        : entry;
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const itemName = record.itemName;
    const itemUrl = record.itemUrl;
    if (typeof itemName !== "string" || typeof itemUrl !== "string") {
      continue;
    }
    const rawImages = Array.isArray(record.mediumImageUrls)
      ? record.mediumImageUrls
      : [];
    const mediumImageUrls: string[] = [];
    for (const image of rawImages) {
      // v2: string / v1: { imageUrl: string }
      if (typeof image === "string") {
        mediumImageUrls.push(image);
      } else if (
        typeof image === "object" &&
        image !== null &&
        typeof (image as { imageUrl?: unknown }).imageUrl === "string"
      ) {
        mediumImageUrls.push((image as { imageUrl: string }).imageUrl);
      }
    }
    candidates.push({ itemName, itemUrl, mediumImageUrls });
  }
  return candidates;
}

/**
 * キーワードで日本酒ジャンルの商品を検索する（上位 HITS_PER_QUERY 件）。
 * 該当なし（wrong_parameter ではなく 0 件）は空配列。429 は 1 回だけ再試行する。
 */
export async function searchSakeItems(
  credentials: RakutenCredentials,
  keyword: string,
  fetchFn: typeof fetch = fetch,
): Promise<RakutenItemCandidate[]> {
  // 楽天 API は 2 文字未満のキーワードを wrong_parameter で弾く。
  // 極端に短い銘柄名（1 文字等）は検索しても意味がないので空扱いにする（400 を出さない）。
  const trimmed = keyword.trim();
  if (trimmed.replace(/\s+/gu, "").length < 2) {
    return [];
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("applicationId", credentials.applicationId);
  url.searchParams.set("accessKey", credentials.accessKey);
  // keyword は API 上限 128 文字（UTF-8）。銘柄名＋蔵元名で超えることは稀だが防御的に切る
  url.searchParams.set("keyword", trimmed.slice(0, 128));
  url.searchParams.set("genreId", SAKE_GENRE_ID);
  url.searchParams.set("hits", String(HITS_PER_QUERY));
  url.searchParams.set("formatVersion", "2");

  for (let attempt = 0; ; attempt++) {
    const response = await fetchFn(url.toString());
    if (response.status === 429 && attempt === 0) {
      await sleep(RETRY_WAIT_MS);
      continue;
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      throw new Error(
        `楽天商品検索 API がエラーを返しました（HTTP ${response.status}）: ${body}`,
      );
    }
    return toCandidates(await response.json());
  }
}
