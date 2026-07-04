import { PREFECTURES } from "@/lib/constants/prefectures";
import type { Prefecture } from "@/lib/constants/prefectures";

/**
 * 都道府県選択 UI（/prefectures）専用の地方グルーピング。
 *
 * 47 都道府県を地方（8 区分）でまとめて一覧を見やすくするための、この画面固有の
 * 並べ替えロジック（DIRECTORY_STRUCTURE §3・DIR-6: 機能固有は _lib へ）。
 * 地方区分は JIS 都道府県コードの範囲で表現する（コードは 2 桁ゼロ埋め文字列）。
 * PREFECTURES を単一情報源とし、名前・コードはここに重複させない。
 */

type RegionDef = {
  name: string;
  /** この地方に含まれる都道府県コードの範囲 [from, to]（両端含む）。 */
  range: [string, string];
};

// 総務省の全国地方公共団体コードの一般的な地方区分に沿った 8 区分。
const REGION_DEFS: readonly RegionDef[] = [
  { name: "北海道・東北", range: ["01", "07"] },
  { name: "関東", range: ["08", "14"] },
  { name: "中部", range: ["15", "23"] },
  { name: "近畿", range: ["24", "30"] },
  { name: "中国", range: ["31", "35"] },
  { name: "四国", range: ["36", "39"] },
  { name: "九州・沖縄", range: ["40", "47"] },
] as const;

export type Region = {
  name: string;
  prefectures: Prefecture[];
};

/**
 * 都道府県を地方ごとにグルーピングして返す。
 * 各地方内は JIS コード昇順（PREFECTURES の並び順）を保つ。
 */
export function groupPrefecturesByRegion(): Region[] {
  return REGION_DEFS.map((def) => ({
    name: def.name,
    prefectures: PREFECTURES.filter(
      (prefecture) =>
        prefecture.code >= def.range[0] && prefecture.code <= def.range[1],
    ),
  }));
}
