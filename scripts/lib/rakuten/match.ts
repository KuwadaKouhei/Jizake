/**
 * 楽天商品検索の結果から「その銘柄のパッケージ画像」として採用する商品を選ぶ
 * 照合ロジック（純関数。ユニットテスト対象）。
 *
 * 方針（FR-09・REQUIREMENTS）: 誤った商品の画像を出すくらいなら出さない。
 * - 銘柄名の包含を必須にする（正規化して比較）。
 * - セット・飲み比べ等の複合商品は NG ワードで除外する（単品のボトル写真を優先）。
 * - 候補が複数残ったら「蔵元名を含む」→「商品名が短い」→「API の関連度順」で選ぶ。
 * - 画像 URL は楽天 CDN（thumbnail.image.rakuten.co.jp）の https のみ受け付ける
 *   （next.config の remotePatterns と一致させ、想定外ドメインを DB に入れない）。
 */

/** 楽天商品検索 API の商品 1 件（照合に使う項目のみ）。 */
export type RakutenItemCandidate = {
  itemName: string;
  itemUrl: string;
  /** formatVersion=2 では string[]、=1 では {imageUrl}[]。クライアント側で string[] に正規化済み */
  mediumImageUrls: string[];
};

/** 採用した商品（画像 URL は拡大版に正規化済み）。 */
export type MatchedImage = {
  itemName: string;
  itemUrl: string;
  imageUrl: string;
};

// 複合商品・非ボトル商品の除外ワード（商品名に含まれたら採用しない）
const NG_KEYWORDS: readonly string[] = [
  "飲み比べ",
  "セット",
  "詰め合わせ",
  "詰合せ",
  "福袋",
  "おつまみ",
  "グラス",
  "猪口",
  "酒器",
  "ポイント消化",
  "訳あり",
  "カレンダー",
];

// 採用する画像 URL のホスト（楽天 CDN。next.config remotePatterns と同期）
export const RAKUTEN_IMAGE_HOST = "thumbnail.image.rakuten.co.jp";

// 表示用に取得する画像の一辺（_ex パラメータ。詳細ページでも十分な 400px）
const IMAGE_SIZE = "400x400";

/** 照合用の正規化: NFKC → 小文字 → 空白除去（全半角・スペース差を無視して包含判定する）。 */
export function normalizeForMatch(input: string): string {
  return input.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

/** 商品名が NG ワード（セット・飲み比べ等）を含むか。 */
export function hasNgKeyword(itemName: string): boolean {
  const normalized = normalizeForMatch(itemName);
  return NG_KEYWORDS.some((ng) => normalized.includes(normalizeForMatch(ng)));
}

/**
 * 楽天 CDN の商品画像 URL を検証し、表示用サイズ（_ex=400x400）へ正規化する。
 * https かつ楽天 CDN 以外・パースできない URL は null（採用しない）。
 */
export function normalizeImageUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== RAKUTEN_IMAGE_HOST) {
    return null;
  }
  // 既存のクエリ（_ex=128x128 等）はサイズ指定なので丸ごと差し替える
  parsed.search = `?_ex=${IMAGE_SIZE}`;
  return parsed.toString();
}

/**
 * 検索結果から採用する 1 件を選ぶ。採用条件を満たす商品が無ければ null。
 *
 * 必須条件: 商品名が銘柄名を含む（正規化比較）／NG ワードを含まない／
 * 楽天 CDN の画像を 1 枚以上持つ。
 * 優先順: 蔵元名を含む > 商品名が短い（余計な同梱・装飾語が少ない）> API の関連度順。
 */
export function selectBestItem(
  sake: { name: string; breweryName: string },
  items: readonly RakutenItemCandidate[],
): MatchedImage | null {
  const sakeName = normalizeForMatch(sake.name);
  if (sakeName.length === 0) {
    return null;
  }
  const breweryName = normalizeForMatch(sake.breweryName);

  type Scored = {
    item: RakutenItemCandidate;
    imageUrl: string;
    breweryIncluded: boolean;
    nameLength: number;
    index: number;
  };
  const candidates: Scored[] = [];

  items.forEach((item, index) => {
    const itemName = normalizeForMatch(item.itemName);
    if (!itemName.includes(sakeName)) {
      return;
    }
    if (hasNgKeyword(item.itemName)) {
      return;
    }
    const imageUrl = item.mediumImageUrls
      .map((url) => normalizeImageUrl(url))
      .find((url): url is string => url !== null);
    if (imageUrl === undefined) {
      return;
    }
    candidates.push({
      item,
      imageUrl,
      breweryIncluded: breweryName.length > 0 && itemName.includes(breweryName),
      nameLength: itemName.length,
      index,
    });
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (a.breweryIncluded !== b.breweryIncluded) {
      return a.breweryIncluded ? -1 : 1;
    }
    if (a.nameLength !== b.nameLength) {
      return a.nameLength - b.nameLength;
    }
    return a.index - b.index;
  });

  const best = candidates[0];
  return {
    itemName: best.item.itemName,
    itemUrl: best.item.itemUrl,
    imageUrl: best.imageUrl,
  };
}
