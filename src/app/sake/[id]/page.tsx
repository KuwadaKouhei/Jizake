import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { cn } from "@/components/ui/cn";

import { findPrefectureByCode } from "@/lib/constants/prefectures";
import { findPriceRangeLabel } from "@/lib/constants/price-ranges";
import { getSakeDetail } from "@/lib/db/queries/sakes";

import { ExternalLinks } from "./_components/external-links";
import { FlavorChartView } from "./_components/flavor-chart";
import { RecordViewTrigger } from "./_components/record-view-trigger";
import { SakeDescription } from "./_components/sake-description";
import { SakeTagList } from "./_components/sake-tag-list";

/**
 * 日本酒詳細ページ（/sake/[id]）— カタログの最初の縦スライス。
 *
 * DESIGN §2.1 / §5.1: RSC が Drizzle クエリ関数（getSakeDetail）を直接呼ぶ。
 * カタログは更新頻度が低い（バッチ投入時のみ）ため時間ベース再検証で静的寄りに配信する。
 * 存在しない / 不正な id は notFound()（not-found.tsx を表示。T05 ⑤）。
 *
 * デザインは Claude Design 3a「淡 — 白×藍」: パンくず → 2 カラム
 * （本文＝タグ・銘柄名・蔵元・紹介文・購入ピル ／ 右＝味わいレーダーのカード）。
 * モバイルは縦積み。
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
    <article className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
      {/* 実閲覧のマウント時に fire-and-forget で閲覧履歴を記録する（DESIGN §2.4）。
          未ログインはサーバ側で no-op。表示には影響しない。 */}
      <RecordViewTrigger sakeId={sake.id} />

      {/* パンくず（3a）: ホーム / さがす / 県 / 銘柄名 */}
      <nav aria-label="パンくず" className="mb-5 text-xs text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="transition-colors hover:text-primary">
              ホーム
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link
              href="/search"
              className="transition-colors hover:text-primary"
            >
              さがす
            </Link>
          </li>
          {prefecture ? (
            <>
              <li aria-hidden>/</li>
              <li>
                <Link
                  href={`/prefectures/${prefecture.code}`}
                  className="transition-colors hover:text-primary"
                >
                  {prefecture.name}
                </Link>
              </li>
            </>
          ) : null}
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-primary">
            {sake.name}
          </li>
        </ol>
      </nav>

      <div
        className={cn(
          "grid items-start gap-8 lg:gap-10",
          // 画像がある銘柄は 3a どおり「画像｜本文｜レーダー」の 3 カラム、
          // 無い銘柄は従来の 2 カラム（画像枠で誤魔化さない。FR-09）
          sake.imageUrl
            ? "lg:grid-cols-[17rem_1fr_20rem]"
            : "lg:grid-cols-[1fr_21rem]",
        )}
      >
        {/* パッケージ画像（楽天市場の商品画像。出典と商品ページへの導線を添える） */}
        {sake.imageUrl ? (
          <figure className="mx-auto w-full max-w-xs lg:mx-0">
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border bg-white">
              <Image
                src={sake.imageUrl}
                alt={`${sake.name}の商品画像`}
                fill
                sizes="(max-width: 1024px) 20rem, 17rem"
                className="object-contain p-4"
                priority
              />
            </div>
            <figcaption className="mt-2 text-center text-xs text-muted-foreground">
              画像:{" "}
              {sake.rakutenUrl ? (
                <a
                  href={sake.rakutenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 transition-colors hover:text-primary"
                >
                  楽天市場の商品ページ
                </a>
              ) : (
                "楽天市場"
              )}
            </figcaption>
          </figure>
        ) : null}

        {/* 本文カラム */}
        <div>
          <SakeTagList tags={sake.tags} />
          <header className="mt-3">
            <h1 className="text-3xl leading-snug font-bold tracking-tight sm:text-4xl">
              {sake.name}
            </h1>
            {sake.reading ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {sake.reading}
              </p>
            ) : null}
            <p className="mt-2 text-sm text-muted-foreground">
              {sake.breweryName}
              {prefecture ? ` ・ ${prefecture.name}` : null}
            </p>
            {priceLabel ? (
              <p className="mt-3 inline-block rounded-full bg-muted px-3 py-1 text-sm">
                価格帯: {priceLabel}
              </p>
            ) : null}
          </header>

          <div className="mt-6 grid gap-6">
            {sake.description ? (
              <SakeDescription description={sake.description} />
            ) : null}
            <ExternalLinks sake={sake} />
          </div>
        </div>

        {/* 味わいレーダー（右カード。モバイルは本文の下に縦積み） */}
        {sake.flavor ? (
          <aside>
            <FlavorChartView flavor={sake.flavor} />
          </aside>
        ) : null}
      </div>
    </article>
  );
}
