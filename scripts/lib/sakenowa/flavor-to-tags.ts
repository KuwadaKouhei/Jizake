import type { SakenowaFlavorChart } from "./schemas";

/**
 * フレーバー 6 軸 → 味タグ変換（純関数）。
 *
 * さけのわ flavor-charts の 6 軸（0..1 正規化済み）のうち、しきい値以上の軸を
 * その軸の公式名の味タグとして付与する（DESIGN §2.7）。
 * しきい値は DESIGN §9 のとおり実装時の定数とし、シードデータで目視検証
 * しながら調整する（実測の値域はおよそ 0.05〜0.78。0.5 以上は明確に
 * その特徴が強い銘柄に絞られる）。
 */

/** 銘柄 ID を除いた 6 軸の値（brandId に依存しない変換入力） */
export type FlavorChartValues = Omit<SakenowaFlavorChart, "brandId">;

/** この値以上の軸を味タグとして付与する */
export const FLAVOR_TAG_THRESHOLD = 0.5;

/** 軸 → タグ名の対応（docs/SAKENOWA_API.md §3 の軸定義に一致させる） */
export const FLAVOR_AXIS_TAGS = [
  { axis: "f1", tagName: "華やか" },
  { axis: "f2", tagName: "芳醇" },
  { axis: "f3", tagName: "重厚" },
  { axis: "f4", tagName: "穏やか" },
  { axis: "f5", tagName: "ドライ" },
  { axis: "f6", tagName: "軽快" },
] as const satisfies readonly {
  axis: keyof FlavorChartValues;
  tagName: string;
}[];

/**
 * しきい値以上の軸に対応する味タグ名を返す（FLAVOR_AXIS_TAGS の定義順）。
 * どの軸もしきい値未満なら空配列。
 */
export function flavorToTagNames(
  chart: FlavorChartValues,
  threshold: number = FLAVOR_TAG_THRESHOLD,
): string[] {
  return FLAVOR_AXIS_TAGS.filter(({ axis }) => chart[axis] >= threshold).map(
    ({ tagName }) => tagName,
  );
}
