import { tagChipClassName } from "@/components/tag-chip";
import { cn } from "@/components/ui/cn";
import type { SakeTagSummary } from "@/lib/db/queries/sakes";

/**
 * 詳細ページのタグ一覧表示（FR-02）。
 *
 * デザインは Claude Design 3a: 銘柄名の上に色分けピルを並べる（見出しは sr-only）。
 * 配色は tag-chip.ts に一元化（一覧カードと共通）。
 *
 * タグ名は信頼できない外部入力（さけのわ由来）を含むため、テキストとして描画する
 * （dangerouslySetInnerHTML 禁止。REVIEW T03/T04 引き継ぎ）。
 */

export function SakeTagList({ tags }: { tags: SakeTagSummary[] }) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="sake-tags-heading">
      <h2 id="sake-tags-heading" className="sr-only">
        タグ
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <li
            key={tag.id}
            className={cn(
              "rounded-full px-3 py-1 text-xs",
              tagChipClassName(tag),
            )}
          >
            {tag.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
