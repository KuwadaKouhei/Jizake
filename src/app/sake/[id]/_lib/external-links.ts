/**
 * 詳細ページの外部リンク組み立て（純関数。ユニットテスト対象）。
 *
 * FR-03: 公式・購入リンクは別タブで開き、リンクが無い場合は非表示にする。
 * ただし Amazon については、amazon_url が無くても銘柄名から検索 URL を静的生成して
 * 導線を残す（DESIGN §2.1）。
 *
 * セキュリティ（REVIEW T04 S-1 引き継ぎ）: DB 由来の URL は seed/import の境界で
 * https 限定に検証済みだが、表示直前にもう一段 https のみを通す（防御的多重化）。
 * 生成する Amazon 検索 URL は固定ドメインのため安全。
 */

// Amazon 検索の固定ベース（DESIGN §2.1 の静的生成）
const AMAZON_SEARCH_BASE = "https://www.amazon.co.jp/s";

export type ExternalLinkKind = "official" | "amazon" | "rakuten";

export type ExternalLink = {
  kind: ExternalLinkKind;
  label: string;
  href: string;
  /** true のとき、DB に URL が無く銘柄名から生成した検索リンク（表記を変える用） */
  generated: boolean;
};

const LABELS: Record<ExternalLinkKind, string> = {
  official: "公式サイト",
  amazon: "Amazon で探す",
  rakuten: "楽天で探す",
};

/** https の絶対 URL のみ通す（それ以外は無効として扱う）。 */
function normalizeHttpsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === "https:" ? parsed.toString() : null;
}

/** 銘柄名から Amazon 検索 URL を生成する（購入リンク欠損時のフォールバック）。 */
export function buildAmazonSearchUrl(sakeName: string): string {
  const params = new URLSearchParams({ k: sakeName });
  return `${AMAZON_SEARCH_BASE}?${params.toString()}`;
}

/**
 * 詳細ページに表示する外部リンクを組み立てる。
 * - official / rakuten: URL があり https のときのみ表示（無ければ非表示）。
 * - amazon: URL があれば購入リンク、無ければ銘柄名から検索 URL を生成して表示。
 */
export function buildExternalLinks(sake: {
  name: string;
  officialUrl: string | null;
  amazonUrl: string | null;
  rakutenUrl: string | null;
}): ExternalLink[] {
  const links: ExternalLink[] = [];

  const official = normalizeHttpsUrl(sake.officialUrl);
  if (official) {
    links.push({
      kind: "official",
      label: LABELS.official,
      href: official,
      generated: false,
    });
  }

  const amazon = normalizeHttpsUrl(sake.amazonUrl);
  links.push({
    kind: "amazon",
    label: LABELS.amazon,
    href: amazon ?? buildAmazonSearchUrl(sake.name),
    generated: amazon === null,
  });

  const rakuten = normalizeHttpsUrl(sake.rakutenUrl);
  if (rakuten) {
    links.push({
      kind: "rakuten",
      label: LABELS.rakuten,
      href: rakuten,
      generated: false,
    });
  }

  return links;
}
