/**
 * 説明文の表示（FR-01）。
 *
 * デザインは Claude Design 3a: 見出しは出さず（sr-only）、ゆったりした行間の本文のみ。
 * 説明文は自作テキストだが、改行を保持しつつ「テキストとして安全に」表示する。
 * dangerouslySetInnerHTML は使わず（REVIEW T03/T04 引き継ぎ）、CSS の
 * whitespace-pre-line で改行を反映する（React のエスケープをそのまま活かす）。
 */

export function SakeDescription({ description }: { description: string }) {
  return (
    <section aria-labelledby="sake-description-heading">
      <h2 id="sake-description-heading" className="sr-only">
        紹介
      </h2>
      <p className="text-sm leading-loose whitespace-pre-line text-foreground/90 sm:text-[0.9rem]">
        {description}
      </p>
    </section>
  );
}
