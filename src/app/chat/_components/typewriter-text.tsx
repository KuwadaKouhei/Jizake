"use client";

import { useEffect, useState } from "react";

import { parseBoldSegments } from "../_lib/bold-segments";

/**
 * 1 文字ずつ現れるタイプライター表示（チャットのアシスタント応答用）。
 *
 * - `active=true`（生成中の最新メッセージ）のときだけ 0 文字から現れ始める。
 *   それ以外（生成完了・過去の発話・テスト）は最初から全文を出す（同期描画）。
 * - ストリーミングで text が伸びても追従し、生成が終わっても未表示ぶんを
 *   最後まで打ち切る（途中で全文にスナップしない）。バックログが多いほど 1 tick の
 *   歩幅を増やして遅れすぎないようにする。
 * - `**〜**`（太字記法）は <strong> に写して表示し、記号そのものは出さない
 *   （parseBoldSegments。文字数カウントは記号を除いた表示文字で行う）。
 * - `prefers-reduced-motion: reduce` では即座に全文表示（アニメを一切出さない）。
 *
 * 文字数はコードポイント単位で数え、サロゲートペアを割らない。
 */

// 1 tick の間隔（ms）と、遅れているときの追いつき係数（大きいほどゆっくり）。
// 基本速度はおよそ 20 文字/秒（ゆっくり）。長文の取りこぼしだけ緩やかに加速する。
const TICK_MS = 48;
const CATCHUP_DIVISOR = 120;

type RevealChar = {
  char: string;
  bold: boolean;
};

/** 表示文字（太字記法を除去済み）を 1 文字ずつ bold フラグ付きで並べる。 */
function toRevealChars(text: string): RevealChar[] {
  return parseBoldSegments(text).flatMap((segment) =>
    [...segment.text].map((char) => ({ char, bold: segment.bold })),
  );
}

/** 先頭 count 文字を bold の連続でグルーピングして React 要素に写す。 */
function renderChars(chars: RevealChar[], count: number) {
  const nodes: React.ReactNode[] = [];
  let buffer = "";
  let bufferBold = false;

  const flush = (key: number) => {
    if (buffer.length === 0) {
      return;
    }
    nodes.push(
      bufferBold ? (
        <strong key={key} className="font-bold">
          {buffer}
        </strong>
      ) : (
        buffer
      ),
    );
    buffer = "";
  };

  chars.slice(0, count).forEach((item, index) => {
    if (buffer.length > 0 && item.bold !== bufferBold) {
      flush(index);
    }
    bufferBold = item.bold;
    buffer += item.char;
  });
  flush(chars.length);

  return nodes;
}

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
  const chars = toRevealChars(text);
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

  const count = reduce ? total : Math.min(revealed, total);
  const typing = !reduce && revealed < total;

  return (
    <>
      {renderChars(chars, count)}
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
