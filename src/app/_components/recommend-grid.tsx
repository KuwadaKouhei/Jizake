import { SakeCard } from "@/components/sake-card";
import type { RecommendedSake } from "@/lib/recommend";

import { recommendReasonLabel } from "../_lib/recommend-reason-label";

/**
 * ホームの推薦カードグリッド（ホーム専用部品。DIRECTORY_STRUCTURE §3: セグメント専用は
 * _components）。共有 SakeCard を再利用し、各カードに推薦理由（reason）を軽く添える
 * （DESIGN §4.2: 推薦の透明性）。
 *
 * 見た目は Claude Design 2c「人気の銘柄」の罫線グリッド: セルを 1px の生成り罫
 * （gap-px + bg-border）で区切り、セル自体は枠を持たない（SakeCard variant="grid"）。
 * モバイル 2 列 → デスクトップ 4 列。
 */
export function RecommendGrid({ items }: { items: RecommendedSake[] }) {
  return (
    <ul className="grid grid-cols-2 gap-px border-y border-border bg-border lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.sake.id} className="flex flex-col bg-card">
          <SakeCard sake={item.sake} variant="grid" />
          <p className="px-4 pb-3 text-[0.7rem] text-muted-foreground">
            {recommendReasonLabel(item.reason)}
          </p>
        </li>
      ))}
    </ul>
  );
}
