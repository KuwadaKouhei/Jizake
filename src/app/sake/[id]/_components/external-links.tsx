import { cn } from "@/components/ui/cn";
import type { SakeDetail } from "@/lib/db/queries/sakes";

import { buildExternalLinks } from "../_lib/external-links";

/**
 * 外部リンク（公式・Amazon・楽天）の表示（FR-03）。
 *
 * デザインは Claude Design 3a: Amazon（購入導線）を藍ベタのピル、公式・楽天を
 * アウトラインのピルで並べる。見出しは出さない（sr-only で意味だけ残す）。
 *
 * - 別タブで開き rel="noopener noreferrer" を付ける（REVIEW T03/T04 引き継ぎ）。
 * - 欠損リンクは非表示。Amazon のみ欠損時に銘柄名から検索 URL を生成する。
 * - href は buildExternalLinks が https のみに正規化済み。
 * - 単なる遷移リンクのため base-ui の Button（クライアント部品）は使わず、
 *   素の <a> にピルのクラスを当てる（不要なハイドレーション回避。PERF S-2）。
 */

export function ExternalLinks({ sake }: { sake: SakeDetail }) {
  const links = buildExternalLinks(sake);

  if (links.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="sake-links-heading">
      <h2 id="sake-links-heading" className="sr-only">
        購入・詳細
      </h2>
      <div className="flex flex-wrap gap-3">
        {links.map((link) => (
          <a
            key={link.kind}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition-opacity hover:opacity-85",
              link.kind === "amazon"
                ? "bg-primary text-primary-foreground"
                : "border-[1.5px] border-primary text-primary",
            )}
          >
            {link.label}
            <span aria-hidden className="text-xs">
              ↗
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
