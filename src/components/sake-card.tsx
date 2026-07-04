import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SakeSummary } from "@/lib/db/queries/sakes";
import { findPrefectureByCode } from "@/lib/constants/prefectures";

/**
 * 銘柄カード。ホーム推薦・検索結果・県別一覧・チャット提案で共用する
 * （DIRECTORY_STRUCTURE §5.1: 複数ルートで使う UI 部品）。
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
    <Card className="h-full transition-shadow hover:shadow-md">
      <Link
        href={`/sake/${sake.id}`}
        className="flex h-full flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardHeader>
          <CardTitle className="text-base">{sake.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {sake.breweryName}
            {prefecture ? ` ・ ${prefecture.name}` : null}
          </p>
        </CardHeader>
        {visibleTags.length > 0 ? (
          <CardContent>
            <ul className="flex flex-wrap gap-1.5">
              {visibleTags.map((tag) => (
                <li
                  key={tag.id}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag.name}
                </li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Link>
    </Card>
  );
}
