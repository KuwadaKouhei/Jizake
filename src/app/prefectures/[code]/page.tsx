import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SakeCard } from "@/components/sake-card";
import { findPrefectureByCode } from "@/lib/constants/prefectures";
import { getSakesByPrefecture } from "@/lib/db/queries/sakes";

/**
 * 都道府県別地酒一覧ページ（/prefectures/[code]）— カタログの縦スライス（FR-07）。
 *
 * DESIGN §2.1 / §5.1: RSC が Drizzle クエリ関数（getSakesByPrefecture）を直接呼ぶ。
 * カタログは更新頻度が低い（バッチ投入時のみ）ため時間ベース再検証で静的寄りに配信する。
 * JIS コード（01..47）でない code は notFound()（not-found.tsx を表示。T06 ④）。
 */

// カタログの時間ベース再検証（DESIGN §2.1）
export const revalidate = 3600;

type PageProps = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
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

export default async function PrefectureSakesPage({ params }: PageProps) {
  const { code } = await params;
  const prefecture = findPrefectureByCode(code);

  // 47 都道府県コード以外は存在しないページとして 404 に落とす（T06 ④）。
  if (!prefecture) {
    notFound();
  }

  const sakes = await getSakesByPrefecture(code);

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
          {sakes.length > 0
            ? `${sakes.length}件の銘柄`
            : "登録されている銘柄はまだありません"}
        </p>
      </header>

      {sakes.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sakes.map((sake) => (
            <li key={sake.id}>
              <SakeCard sake={sake} />
            </li>
          ))}
        </ul>
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
