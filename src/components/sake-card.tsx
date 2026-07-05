import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/components/ui/cn";
import type { SakeSummary, SakeTagSummary } from "@/lib/db/queries/sakes";
import { findPrefectureByCode } from "@/lib/constants/prefectures";

/**
 * 銘柄カード。ホーム推薦・検索結果・県別一覧・チャット提案で共用する
 * （DIRECTORY_STRUCTURE §5.1: 複数ルートで使う UI 部品）。
 *
 * デザインは Claude Design 1c「藍染めの世界」: 銘柄名を明朝の縦書きで左に立て、
 * 右に蔵元・産地・味タグを添える。種別タグ（純米/大吟醸など）は藍ベタ、
 * それ以外（味わい）は罫線チップで差をつける。
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

function tagClassName(tag: SakeTagSummary): string {
  // 種別（純米・吟醸など）は藍ベタ、味わい等は罫線チップ（1c のタグ表現）。
  return tag.category === "type"
    ? "bg-primary text-primary-foreground"
    : "border border-border text-secondary-foreground";
}

export function SakeCard({ sake }: { sake: SakeSummary }) {
  const prefecture = findPrefectureByCode(sake.prefectureCode);
  const visibleTags = sake.tags.slice(0, MAX_CARD_TAGS);

  return (
    <div className="h-full overflow-hidden rounded-sm bg-card ring-1 ring-foreground/10 transition-shadow hover:shadow-md">
      <Link
        href={`/sake/${sake.id}`}
        className="flex h-full items-stretch outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* 縦書き明朝の銘柄名（藍の面に生成りの帯で立てる） */}
        <div className="flex flex-none items-center justify-center border-r border-border bg-primary/[0.04] px-1.5 py-3">
          <span className="font-heading text-[0.95rem] leading-tight font-bold tracking-[0.12em] text-primary [writing-mode:vertical-rl]">
            {sake.name}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-2 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            {sake.breweryName}
            {prefecture ? ` ・ ${prefecture.name}` : null}
          </p>
          {visibleTags.length > 0 ? (
            <ul className="mt-auto flex flex-wrap gap-1.5">
              {visibleTags.map((tag) => (
                <li
                  key={tag.id}
                  className={cn(
                    "rounded-sm px-2 py-0.5 text-[0.7rem]",
                    tagClassName(tag),
                  )}
                >
                  {tag.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <ChevronRight
          className="my-auto mr-1.5 size-4 flex-none text-muted-foreground/60"
          aria-hidden
        />
      </Link>
    </div>
  );
}
