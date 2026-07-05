"use client";

import { useEffect, useState } from "react";

/**
 * 1 文字ずつ現れるタイプライター表示（チャットのアシスタント応答用）。
 *
 * - `active=true`（生成中の最新メッセージ）のときだけ 0 文字から現れ始める。
 *   それ以外（生成完了・過去の発話・テスト）は最初から全文を出す（同期描画）。
 * - ストリーミングで text が伸びても追従し、生成が終わっても未表示ぶんを
 *   最後まで打ち切る（途中で全文にスナップしない）。バックログが多いほど 1 tick の
 *   歩幅を増やして遅れすぎないようにする。
 * - `prefers-reduced-motion: reduce` では即座に全文表示（アニメを一切出さない）。
 *
 * 文字数はコードポイント単位（[...text]）で数え、サロゲートペアを割らない。
 */

// 1 tick の間隔（ms）と、遅れているときの追いつき係数（大きいほどゆっくり）。
const TICK_MS = 22;
const CATCHUP_DIVISOR = 28;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function TypewriterText({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  const chars = [...text];
  const total = chars.length;
  const reduce = prefersReducedMotion();

  const [revealed, setRevealed] = useState(() => (active ? 0 : total));

  useEffect(() => {
    // reduced-motion では描画側で全文を出すのでタイマーを回さない
    // （effect 本体で直接 setState しない: react-hooks/set-state-in-effect）。
    if (reduce || revealed >= total) {
      return;
    }
    const id = setTimeout(() => {
      setRevealed((current) => {
        if (current >= total) {
          return current;
        }
        const step = Math.max(
          1,
          Math.ceil((total - current) / CATCHUP_DIVISOR),
        );
        return Math.min(total, current + step);
      });
    }, TICK_MS);
    return () => clearTimeout(id);
  }, [revealed, total, reduce]);

  const shown = reduce ? text : chars.slice(0, revealed).join("");
  const typing = !reduce && revealed < total;

  return (
    <>
      {shown}
      {typing ? (
        <span
          aria-hidden
          className="ml-px inline-block animate-pulse text-primary/70"
        >
          ▍
        </span>
      ) : null}
    </>
  );
}
