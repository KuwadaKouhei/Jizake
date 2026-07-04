import type { SakeTagSummary } from "@/lib/db/queries/sakes";

/**
 * 詳細ページのタグ一覧表示（FR-02）。
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
      <h2 id="sake-tags-heading" className="mb-2 text-sm font-semibold">
        タグ
      </h2>
      <ul className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <li
            key={tag.id}
            className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground"
          >
            {tag.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
