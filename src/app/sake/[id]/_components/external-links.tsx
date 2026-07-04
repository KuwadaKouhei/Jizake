import { buttonVariants } from "@/components/ui/button";
import type { SakeDetail } from "@/lib/db/queries/sakes";

import { buildExternalLinks } from "../_lib/external-links";

/**
 * 外部リンク（公式・Amazon・楽天）の表示（FR-03）。
 *
 * - 別タブで開き rel="noopener noreferrer" を付ける（REVIEW T03/T04 引き継ぎ）。
 * - 欠損リンクは非表示。Amazon のみ欠損時に銘柄名から検索 URL を生成する。
 * - href は buildExternalLinks が https のみに正規化済み。
 * - 単なる遷移リンクのため base-ui の Button（クライアント部品）は使わず、
 *   buttonVariants の className を素の <a> に当てる（不要なハイドレーション回避。PERF S-2）。
 */

export function ExternalLinks({ sake }: { sake: SakeDetail }) {
  const links = buildExternalLinks(sake);

  if (links.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="sake-links-heading">
      <h2 id="sake-links-heading" className="mb-2 text-sm font-semibold">
        購入・詳細
      </h2>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.kind}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
