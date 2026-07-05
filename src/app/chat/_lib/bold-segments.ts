/**
 * アシスタント応答の `**〜**`（Markdown の太字記法）を表示用セグメントに分解する純関数。
 *
 * LLM は太字記法を混ぜて返すことがあり、プレーンテキスト表示だと `**` がそのまま
 * 見えてしまう（ユーザー指摘 2026-07-05）。HTML を描画せず React 要素（<strong>）へ
 * 写すため、まずここで「太字/通常」のセグメント列に分ける（dangerouslySetInnerHTML は
 * 使わない方針のまま。DESIGN §6.2）。
 *
 * - `**` で分割し、奇数番目のパートを太字にする（"a **b** c" → a / b(太字) / c）。
 * - 閉じ `**` がまだ無い場合（ストリーミング生成の途中）は、開いた以降を太字として
 *   扱う（記号は表示しない。閉じが届いても表示は変わらず安定）。
 * - 対応するのは太字のみ。他の記法はプロンプト側で禁止する（prompts.ts）。
 */

export type BoldSegment = {
  text: string;
  bold: boolean;
};

export function parseBoldSegments(text: string): BoldSegment[] {
  const parts = text.split("**");
  const segments: BoldSegment[] = [];
  parts.forEach((part, index) => {
    if (part.length === 0) {
      return;
    }
    segments.push({ text: part, bold: index % 2 === 1 });
  });
  return segments;
}
