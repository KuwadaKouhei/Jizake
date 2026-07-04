/**
 * 価格帯 3 区分の表示名。
 * 値は DATABASE.md の CHECK 制約（sakes.price_range）と一致させる
 * （FEASIBILITY §2.2 案C。ベストエフォート項目）。
 */
export type PriceRangeValue = "under_1500" | "from_1500_to_3000" | "over_3000";

export type PriceRange = {
  value: PriceRangeValue;
  label: string;
};

export const PRICE_RANGES: readonly PriceRange[] = [
  { value: "under_1500", label: "〜1,500円" },
  { value: "from_1500_to_3000", label: "1,500〜3,000円" },
  { value: "over_3000", label: "3,000円〜" },
] as const;

export function findPriceRangeLabel(
  value: string,
): PriceRange["label"] | undefined {
  return PRICE_RANGES.find((range) => range.value === value)?.label;
}
