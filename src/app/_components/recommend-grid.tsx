import { SakeCard } from "@/components/sake-card";
import type { RecommendedSake } from "@/lib/recommend";

import { recommendReasonLabel } from "../_lib/recommend-reason-label";

/**
 * ホームの推薦カードグリッド（ホーム専用部品。DIRECTORY_STRUCTURE §3: セグメント専用は
 * _components）。共有 SakeCard を再利用し、各カードに推薦理由（reason）を軽く添える
 * （DESIGN §4.2: 推薦の透明性）。
 *
 * 見た目は Claude Design 2a「人気の日本酒」: 角丸カードをモバイル 2 列→
 * デスクトップ 4 列で並べる。
 */
export function RecommendGrid({ items }: { items: RecommendedSake[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.sake.id} className="grid gap-1">
          <SakeCard sake={item.sake} />
          <p className="px-1 text-[0.7rem] text-muted-foreground">
            {recommendReasonLabel(item.reason)}
          </p>
        </li>
      ))}
    </ul>
  );
}
