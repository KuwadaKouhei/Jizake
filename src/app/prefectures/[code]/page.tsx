import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SakeCard } from "@/components/sake-card";
import { PREFECTURES, findPrefectureByCode } from "@/lib/constants/prefectures";
import { getSakesByPrefecture } from "@/lib/db/queries/sakes";

import { parsePageParam, totalPageCount } from "./_lib/pagination";

/**
 * 都道府県別地酒一覧ページ（/prefectures/[code]）— カタログの縦スライス（FR-07）。
 *
 * DESIGN §2.1 / §5.1: RSC が Drizzle クエリ関数（getSakesByPrefecture）を直接呼ぶ。
 * カタログは更新頻度が低い（バッチ投入時のみ）ため時間ベース再検証で静的寄りに配信する。
 * JIS コード（01..47）でない code は notFound()（not-found.tsx を表示。T06 ④）。
 * 一覧は 24 件/頁でページ送りする（DESIGN §6.1。ページは ?page= の searchParams）。
 */

// カタログの時間ベース再検証（DESIGN §2.1）
export const revalidate = 3600;

// 全 47 都道府県コードをビルド時プリレンダ対象にする（初回から静的配信・ISR 併用）。
// ?page= を searchParams で読むため build の Route 判定上は ƒ (Dynamic) になるが、
// generateStaticParams により 47 パスはビルド時に事前生成され、revalidate=3600 の
// ISR と併用される（1 ページ目は事前生成キャッシュ、2 ページ目以降はオンデマンド）。
// 将来ページを [code]/[page] のパスセグメントに移せば完全静的化できる（最適化余地）。
export function generateStaticParams() {
  return PREFECTURES.map((prefecture) => ({ code: prefecture.code }));
}

type PageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

export async function generateMetadata({
  params,
}: Pick<PageProps, "params">): Promise<Metadata> {
  const { code } = await params;
  const prefecture = findPrefectureByCode(code);
  if (!prefecture) {
    // 生成できない場合はレイアウトのデフォルトタイトルに委ねる
    return {};
  }
  return {
    title: `${prefecture.name}の地酒`,
    description: `${prefecture.name}の蔵元がつくる日本酒の一覧。`,
  };
}

export default async function PrefectureSakesPage({
  params,
  searchParams,
}: PageProps) {
  const { code } = await params;
  const prefecture = findPrefectureByCode(code);

  // 47 都道府県コード以外は存在しないページとして 404 に落とす（T06 ④）。
  if (!prefecture) {
    notFound();
  }

  const { page: pageParam } = await searchParams;
  const page = parsePageParam(pageParam);

  const result = await getSakesByPrefecture(code, page);
  const totalPages = totalPageCount(result.total, result.pageSize);

  // 総ページ数を超える page を手打ちされたら最終ページへ丸める
  // （total > 0 のときのみ。0 件なら丸め先が無いので下の空状態を出す）。
  if (result.total > 0 && page > totalPages) {
    redirect(`/prefectures/${code}?page=${totalPages}`);
  }

  const { sakes } = result;

  return (
    <section className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <header className="mb-6 border-b pb-6">
        <p className="text-sm text-muted-foreground">
          <Link
            href="/prefectures"
            className="underline-offset-2 hover:underline"
          >
            都道府県から探す
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          {prefecture.name}の地酒
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {result.total > 0
            ? `${result.total}件の銘柄`
            : "登録されている銘柄はまだありません"}
        </p>
      </header>

      {sakes.length > 0 ? (
        <>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sakes.map((sake) => (
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
              {page > 1 ? (
                <Link
                  href={`/prefectures/${code}?page=${page - 1}`}
                  className="text-sm underline underline-offset-2"
                  rel="prev"
                >
                  ← 前へ
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground/50">← 前へ</span>
              )}
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages} ページ
              </span>
              {page < totalPages ? (
                <Link
                  href={`/prefectures/${code}?page=${page + 1}`}
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
          {prefecture.name}の地酒はまだ登録されていません。
          <br />
          <Link
            href="/prefectures"
            className="mt-2 inline-block underline underline-offset-2"
          >
            ほかの都道府県を見る
          </Link>
        </p>
      )}
    </section>
  );
}
