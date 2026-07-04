import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SakeCard } from "@/components/sake-card";
import { PREFECTURES } from "@/lib/constants/prefectures";
import { getSearchSakes } from "@/lib/db/queries/sakes";
import { getTasteTagOptions } from "@/lib/db/queries/tags";
import { totalPageCount } from "@/lib/pagination/pagination";

import {
  buildSearchCriteria,
  toSearchQueryString,
  type RawSearchParams,
} from "./_lib/build-search-query";

/**
 * 検索ページ（/search）— 名前・都道府県・味タグの複合検索（FR-06 / FR-02）。
 *
 * DESIGN §2.2: 検索状態は URL クエリパラメータで表現し、RSC が searchParams から
 * 検索条件を組み立てて（純関数 buildSearchCriteria）Drizzle クエリ（getSearchSakes）を
 * 直接呼ぶ。フォームは method=GET の素の form でクライアント JS を持たない。
 * 結果は SakeCard グリッド＋ページャ（一覧と同型・24 件/頁）。0 件は空状態。
 */

export const metadata: Metadata = {
  title: "検索",
  description: "日本酒を名前・都道府県・味わいのタグで検索する。",
};

// 検索結果はクエリ依存のため動的レンダリングする（DESIGN §6.1。カタログ系の時間ベース
// 再検証には乗せない＝同一クエリでも履歴投入 T09 の反映を古いキャッシュで遅らせない）。
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<RawSearchParams>;
};

export default async function SearchPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const criteria = buildSearchCriteria(raw);
  const [result, tasteTags] = await Promise.all([
    getSearchSakes({
      q: criteria.q,
      prefectureCode: criteria.prefectureCode,
      tagNames: criteria.tagNames,
      page: criteria.page,
    }),
    getTasteTagOptions(),
  ]);

  const totalPages = totalPageCount(result.total, result.pageSize);

  // 総ページ数を超える page を手打ちされたら最終ページへ丸める（条件は保持）。
  if (result.total > 0 && criteria.page > totalPages) {
    redirect(`/search${toSearchQueryString(criteria, totalPages)}`);
  }

  const selectedTags = new Set(criteria.tagNames);

  return (
    <section className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          日本酒を検索
        </h1>
      </header>

      {/* method=GET の素の form。送信で ?q=&prefecture=&tags= に反映される（クライアント JS 不要）。 */}
      <form method="get" className="mb-8 grid gap-4 rounded-lg border p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">名前・読み</span>
            <input
              type="text"
              name="q"
              defaultValue={criteria.q ?? ""}
              maxLength={100}
              placeholder="例: 獺祭、だっさい"
              className="h-9 rounded-md border px-3 text-sm"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">都道府県</span>
            <select
              name="prefecture"
              defaultValue={criteria.prefectureCode ?? ""}
              className="h-9 rounded-md border px-3 text-sm"
            >
              <option value="">すべて</option>
              {PREFECTURES.map((prefecture) => (
                <option key={prefecture.code} value={prefecture.code}>
                  {prefecture.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {tasteTags.length > 0 ? (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">
              味わい（複数選択で絞り込み）
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {tasteTags.map((tag) => (
                <label
                  key={tag.id}
                  className="flex items-center gap-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name="tags"
                    value={tag.name}
                    defaultChecked={selectedTags.has(tag.name)}
                  />
                  {tag.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div>
          <button
            type="submit"
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            検索する
          </button>
        </div>
      </form>

      <p className="mb-4 text-sm text-muted-foreground">
        {result.total > 0
          ? `${result.total}件の銘柄が見つかりました`
          : "条件に合う銘柄が見つかりませんでした"}
      </p>

      {result.sakes.length > 0 ? (
        <>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.sakes.map((sake) => (
              <li key={sake.id}>
                <SakeCard sake={sake} />
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            <nav
              aria-label="ページ送り"
              className="mt-8 flex items-center justify-between gap-4"
            >
              {criteria.page > 1 ? (
                <Link
                  href={`/search${toSearchQueryString(criteria, criteria.page - 1)}`}
                  className="text-sm underline underline-offset-2"
                  rel="prev"
                >
                  ← 前へ
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground/50">← 前へ</span>
              )}
              <span className="text-sm text-muted-foreground">
                {criteria.page} / {totalPages} ページ
              </span>
              {criteria.page < totalPages ? (
                <Link
                  href={`/search${toSearchQueryString(criteria, criteria.page + 1)}`}
                  className="text-sm underline underline-offset-2"
                  rel="next"
                >
                  次へ →
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground/50">次へ →</span>
              )}
            </nav>
          ) : null}
        </>
      ) : (
        <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          条件を変えて検索してください。
        </p>
      )}
    </section>
  );
}
