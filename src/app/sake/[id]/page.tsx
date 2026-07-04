import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { findPrefectureByCode } from "@/lib/constants/prefectures";
import { findPriceRangeLabel } from "@/lib/constants/price-ranges";
import { getSakeDetail } from "@/lib/db/queries/sakes";

import { ExternalLinks } from "./_components/external-links";
import { FlavorChartView } from "./_components/flavor-chart";
import { SakeDescription } from "./_components/sake-description";
import { SakeTagList } from "./_components/sake-tag-list";

/**
 * 日本酒詳細ページ（/sake/[id]）— カタログの最初の縦スライス。
 *
 * DESIGN §2.1 / §5.1: RSC が Drizzle クエリ関数（getSakeDetail）を直接呼ぶ。
 * カタログは更新頻度が低い（バッチ投入時のみ）ため時間ベース再検証で静的寄りに配信する。
 * 存在しない / 不正な id は notFound()（not-found.tsx を表示。T05 ⑤）。
 */

// カタログの時間ベース再検証（DESIGN §2.1）
export const revalidate = 3600;

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const sake = await getSakeDetail(id);
  if (!sake) {
    // 生成できない場合はレイアウトのデフォルトタイトルに委ねる
    return {};
  }
  // 空文字の説明文（?? は null/undefined のみ捕捉）でもフォールバックするよう trim で判定
  const description = sake.description?.trim();
  return {
    title: sake.name,
    description: description
      ? description.slice(0, 120)
      : `${sake.breweryName}の${sake.name}の詳細ページ`,
  };
}

export default async function SakeDetailPage({ params }: PageProps) {
  const { id } = await params;
  const sake = await getSakeDetail(id);

  if (!sake) {
    notFound();
  }

  const prefecture = findPrefectureByCode(sake.prefectureCode);
  const priceLabel = sake.priceRange
    ? findPriceRangeLabel(sake.priceRange)
    : undefined;

  return (
    <article className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <header className="mb-6 border-b pb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {sake.name}
        </h1>
        {sake.reading ? (
          <p className="mt-1 text-sm text-muted-foreground">{sake.reading}</p>
        ) : null}
        <p className="mt-2 text-sm text-muted-foreground">
          {sake.breweryName}
          {prefecture ? ` ・ ${prefecture.name}` : null}
        </p>
        {priceLabel ? (
          <p className="mt-3 inline-block rounded-md bg-muted px-2.5 py-1 text-sm">
            価格帯: {priceLabel}
          </p>
        ) : null}
      </header>

      <div className="grid gap-8">
        {sake.description ? (
          <SakeDescription description={sake.description} />
        ) : null}
        <SakeTagList tags={sake.tags} />
        {sake.flavor ? <FlavorChartView flavor={sake.flavor} /> : null}
        <ExternalLinks sake={sake} />
      </div>
    </article>
  );
}
