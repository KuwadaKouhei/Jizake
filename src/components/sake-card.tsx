import Image from "next/image";
import Link from "next/link";

import { SakeImagePlaceholder } from "@/components/sake-image-placeholder";
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

// 段階入場の 1 枚あたり遅延（ms）と、遅延が伸びすぎないための上限枚数。
const STAGGER_STEP_MS = 45;
const STAGGER_MAX_ITEMS = 10;

/**
 * @param index 一覧内の並び順。段階入場（stagger）の遅延に使う。省略時は遅延なし。
 */
export function SakeCard({
  sake,
  index,
}: {
  sake: SakeSummary;
  index?: number;
}) {
  const prefecture = findPrefectureByCode(sake.prefectureCode);
  const visibleTags = sake.tags.slice(0, MAX_CARD_TAGS);
  const delayMs =
    index === undefined
      ? undefined
      : Math.min(index, STAGGER_MAX_ITEMS) * STAGGER_STEP_MS;

  return (
    <div
      // ホバー演出（豪華）: 浮き上がり＋影＋枠の藍化。transform 系は動きを好む設定のみ。
      // 段階入場（sake-card-in）は globals の keyframe（reduced-motion では無効）。
      style={
        delayMs === undefined ? undefined : { animationDelay: `${delayMs}ms` }
      }
      className={cn(
        "group relative h-full overflow-hidden rounded-xl border border-border bg-card",
        "transition-[transform,box-shadow,border-color] duration-300 ease-out",
        "hover:border-primary/40 hover:shadow-xl motion-safe:hover:-translate-y-1.5",
        // 段階入場。アニメ定義は globals の @media (no-preference) 内なので、
        // reduced-motion では素通り（クラスは付くが animation 無し＝ちらつかない）。
        "sake-card-in",
      )}
    >
      <Link
        href={`/sake/${sake.id}`}
        className="flex h-full flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* パッケージ画像（楽天 CDN。FR-09）。無い銘柄は共通の No Image プレースホルダ（T18）。
            ホバーでズーム＋斜めの光沢スイープ（overflow-hidden で枠内にクリップ）。 */}
        <div className="relative h-28 w-full overflow-hidden border-b border-border bg-white sm:h-32">
          {sake.imageUrl ? (
            <Image
              src={sake.imageUrl}
              alt={`${sake.name}の商品画像`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-contain p-2 transition-transform duration-500 ease-out motion-safe:group-hover:scale-110"
            />
          ) : (
            <div className="h-full w-full transition-transform duration-500 ease-out motion-safe:group-hover:scale-105">
              <SakeImagePlaceholder />
            </div>
          )}
          {/* 光沢スイープ（装飾）。ホバーで左→右に光が走る。 */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 ease-out motion-safe:group-hover:translate-x-full"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div>
            <p className="flex items-center gap-1 text-base leading-snug font-bold transition-colors duration-200 group-hover:text-primary">
              <span>{sake.name}</span>
              {/* ホバーで現れて滑り込む矢印（装飾） */}
              <span
                aria-hidden
                className="text-primary opacity-0 transition-all duration-200 ease-out group-hover:translate-x-0.5 group-hover:opacity-100 motion-reduce:transition-none"
              >
                →
              </span>
            </p>
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
                    "rounded-full px-2.5 py-0.5 text-[0.7rem] transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5",
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
