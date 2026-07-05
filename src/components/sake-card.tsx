import Image from "next/image";
import Link from "next/link";

import { tagChipClassName } from "@/components/tag-chip";
import { cn } from "@/components/ui/cn";
import type { SakeSummary } from "@/lib/db/queries/sakes";
import { findPrefectureByCode } from "@/lib/constants/prefectures";

/**
 * 銘柄カード。ホーム推薦・検索結果・県別一覧・チャット提案で共用する
 * （DIRECTORY_STRUCTURE §5.1: 複数ルートで使う UI 部品）。
 *
 * デザインは Claude Design 2a「淡 — 白×藍」: 白地・角丸のカードに銘柄名（太字）、
 * 蔵元・産地、味わいで色分けしたピル形タグを積む。
 *
 * props は SakeSummary（データアクセス層のアプリ内型）のみを受け取り、
 * プレゼンテーションに徹する（DIRECTORY_STRUCTURE §5.2: src/components は
 * props 中心・src/app を import しない）。
 *
 * 注意（REVIEW T03/T04 引き継ぎ）: name・breweryName・タグ名は
 * 信頼できない外部入力（さけのわ由来）を含むため、必ずテキストとして描画する。
 * React は既定で子テキストをエスケープするので dangerouslySetInnerHTML は使わない。
 */

// カードに載せる主要タグの上限（多すぎると一覧が見づらい）
const MAX_CARD_TAGS = 3;

export function SakeCard({ sake }: { sake: SakeSummary }) {
  const prefecture = findPrefectureByCode(sake.prefectureCode);
  const visibleTags = sake.tags.slice(0, MAX_CARD_TAGS);

  return (
    <div className="h-full overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md">
      <Link
        href={`/sake/${sake.id}`}
        className="flex h-full flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* パッケージ画像（楽天 CDN。FR-09）。無い銘柄は画像枠ごと出さない */}
        {sake.imageUrl ? (
          <div className="relative h-28 w-full border-b border-border bg-white sm:h-32">
            <Image
              src={sake.imageUrl}
              alt={`${sake.name}の商品画像`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-contain p-2"
            />
          </div>
        ) : null}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div>
            <p className="text-base leading-snug font-bold">{sake.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {sake.breweryName}
              {prefecture ? ` ・ ${prefecture.name}` : null}
            </p>
          </div>
          {visibleTags.length > 0 ? (
            <ul className="mt-auto flex flex-wrap gap-1.5 pt-1">
              {visibleTags.map((tag) => (
                <li
                  key={tag.id}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[0.7rem]",
                    tagChipClassName(tag),
                  )}
                >
                  {tag.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Link>
    </div>
  );
}
