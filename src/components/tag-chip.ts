import type { SakeTagSummary } from "@/lib/db/queries/sakes";

/**
 * タグチップの配色（Claude Design 2a「淡 — 白×藍」）。
 *
 * 種別タグ（純米・吟醸など category=type）は藍系で統一し、味わいタグ（category=taste）は
 * 意味に合わせて色分けする（甘口系=暖色 / 辛口=青 / 淡麗系=緑 / 旨口・燗系=黄土）。
 * 未知のタグ名・その他カテゴリは藍系デフォルトに倒す（さけのわ由来の任意タグ名でも
 * 破綻しない）。SakeCard（一覧）と SakeTagList（詳細）で共用する。
 */

const DEFAULT_TAG_CLASS = "bg-[#eef2f7] text-[#4a6285]";

const TASTE_TAG_CLASSES: Record<string, string> = {
  甘口: "bg-[#fdf1ee] text-[#a55744]",
  芳醇: "bg-[#fdf1ee] text-[#a55744]",
  辛口: "bg-[#eaf2fb] text-[#33608f]",
  淡麗: "bg-[#ecf1e6] text-[#5d7a4e]",
  軽快: "bg-[#ecf1e6] text-[#5d7a4e]",
  濃醇: "bg-[#f3efe2] text-[#8f7a3c]",
  旨口: "bg-[#f3efe2] text-[#8f7a3c]",
  燗向き: "bg-[#f3efe2] text-[#8f7a3c]",
};

export function tagChipClassName(
  tag: Pick<SakeTagSummary, "name" | "category">,
): string {
  if (tag.category === "taste") {
    return TASTE_TAG_CLASSES[tag.name] ?? DEFAULT_TAG_CLASS;
  }
  return DEFAULT_TAG_CLASS;
}
