import { z } from "zod";

import { parsePageParam } from "@/lib/pagination/pagination";

/**
 * 検索条件の組み立て（URL クエリパラメータ → 検索条件の純関数）。
 *
 * DESIGN §2.2 / 決定 D7: 検索状態は URL クエリパラメータで表現する
 * （共有可能 URL・ブラウザバック・SSR・履歴記録の filters 再現をすべて満たす）。
 * DESIGN §5.2 / §7: URL 検索パラメータは信頼できない外部入力なので Zod でパース・
 * サニタイズ・正規化し、不正値は無視してデフォルトへ倒す。この境界処理を純関数に
 * 分離してユニットテスト対象にする（TEST_PHILOSOPHY: 検索条件の組み立てを厚くテスト）。
 *
 * ここは UI・DB のどちらにも依存しない（DIRECTORY_STRUCTURE §5.2: _lib は純関数・型）。
 */

/** Next.js の searchParams が各キーで取り得る生の形。 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * 正規化済みの検索条件。search_histories.filters（jsonb）とも同形にできる形
 * （DATABASE §2.7: filters は Zod SearchParams と同形）。
 *
 * - q: 名前の部分一致キーワード（name / reading を ILIKE で OR 検索）。空なら undefined。
 * - prefectureCode: 都道府県 JIS コード（単一）。不正・非存在コードは undefined。
 * - tagNames: 味タグ名の配列（複数選択・AND 絞り込み）。重複除去・空要素除去済み。
 * - page: 1 始まりのページ番号。
 *
 * 都道府県は DESIGN §5.3 の SearchParams に従い単一（prefectureCode?: string）。
 * 複数県対応は要求がないため YAGNI（早すぎる抽象化をしない）。
 */
export type SearchCriteria = {
  q?: string;
  prefectureCode?: string;
  tagNames: string[];
  page: number;
};

// 名前キーワードの上限長。DoS・無意味に長い LIKE パターンを防ぐ境界制限
// （ILIKE の "%…%" に素直に載せられる長さ。UI の入力欄も同値で制限する）。
const MAX_QUERY_LENGTH = 100;
// 同時指定できる味タグ数の上限。UI の候補数（DB の taste タグ）に対して十分広く、
// URL 手打ちで過大な AND 条件（EXISTS の連結）を生まないための保険。
const MAX_TAGS = 20;

/**
 * 生の文字列/配列を、トリム済み・空/重複除去済み・ソート済みの文字列配列に正規化する。
 *
 * ソートは味タグを「順序に意味のない集合」として扱うため（`?tags=辛口&tags=淡麗` と
 * `?tags=淡麗&tags=辛口` を同一表現に寄せる）。これで共有 URL・React.cache キー・
 * 生成 SQL（EXISTS の alias 順）がすべて決定的になる（CODE レビュー S-2）。
 */
function normalizeStringList(raw: string | string[] | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  const values = Array.isArray(raw) ? raw : [raw];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      seen.add(trimmed);
    }
  }
  return [...seen].sort();
}

// 名前キーワード q: 文字列/配列（同名複数指定）を受け、先頭要素をトリム。
// 空文字は「条件なし」として undefined に倒す。上限長で切り詰める。
const qSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((raw) => {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = value?.trim() ?? "";
    if (trimmed.length === 0) {
      return undefined;
    }
    return trimmed.slice(0, MAX_QUERY_LENGTH);
  });

// 都道府県コード prefecture: JIS コード 2 桁（01..47）のみ受理。
// 書式外・非存在コードは undefined（無視してデフォルト）に倒す（DESIGN §5.2）。
const prefectureSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((raw) => {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = value?.trim() ?? "";
    return /^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(trimmed) ? trimmed : undefined;
  });

// 味タグ tags: 単一指定（?tags=辛口）でも複数指定（?tags=辛口&tags=淡麗）でも受ける。
// トリム・空除去・重複除去し、上限数で切り詰める。
const tagsSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((raw) => normalizeStringList(raw).slice(0, MAX_TAGS));

const searchParamsSchema = z.object({
  q: qSchema,
  prefecture: prefectureSchema,
  tags: tagsSchema,
  // ページ番号の正規化・上限は共有の parsePageParam に一本化する（重複排除。CODE C-1）。
  page: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => parsePageParam(raw)),
});

/**
 * URL の searchParams を正規化済みの検索条件に変換する（純関数）。
 *
 * どのキーが欠けていても・不正でも例外を投げず、デフォルトへ倒した SearchCriteria を返す
 * （検索フォームは常に描画でき、壊れた URL でも 500 にしない）。
 */
export function buildSearchCriteria(raw: RawSearchParams): SearchCriteria {
  const parsed = searchParamsSchema.parse(raw);
  return {
    q: parsed.q,
    prefectureCode: parsed.prefecture,
    tagNames: parsed.tags,
    page: parsed.page,
  };
}

/**
 * 検索条件がすべて空（名前・都道府県・タグのいずれも指定なし）かを判定する。
 *
 * 空条件のときは「全件を名前順で表示」する（DESIGN §2.2 に既定がないため、
 * 空状態で入力を促すのではなく全件表示＋ページャに倒す。検索フォームは常に表示）。
 * 履歴記録（T09）でも「条件が完全に空の検索は記録しない」判定に再利用できる
 * （DATABASE §2.7 の CHECK と対応）。
 */
export function isEmptyCriteria(criteria: SearchCriteria): boolean {
  return (
    criteria.q === undefined &&
    criteria.prefectureCode === undefined &&
    criteria.tagNames.length === 0
  );
}

/**
 * 検索条件を `/search` のクエリ文字列に直す（純関数）。
 *
 * ページャのリンクで現在の検索条件（q・prefecture・tags）を保ったまま page だけ
 * 差し替えるために使う。page 引数を渡すとその値で上書きする（未指定なら criteria.page）。
 * 空の条件はキーごと省き、共有可能で最小の URL にする。
 */
export function toSearchQueryString(
  criteria: SearchCriteria,
  page?: number,
): string {
  const params = new URLSearchParams();
  if (criteria.q !== undefined) {
    params.set("q", criteria.q);
  }
  if (criteria.prefectureCode !== undefined) {
    params.set("prefecture", criteria.prefectureCode);
  }
  for (const tagName of criteria.tagNames) {
    params.append("tags", tagName);
  }
  const targetPage = page ?? criteria.page;
  if (targetPage > 1) {
    params.set("page", String(targetPage));
  }
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}
