/**
 * ページ番号処理の純関数（一覧・検索で共有）。
 *
 * URL の ?page= は信頼できない外部入力なので、この関数で 1 以上の整数に丸めて
 * 境界検証する。県別一覧（T06）と検索（T07）の 2 機能が同じ規則を必要とし、
 * 機能固有の _lib からパス依存で相互 import すると DIRECTORY_STRUCTURE §5.2
 * 「機能ロジック同士は横に依存しない」に反するため、責務名ディレクトリ
 * src/lib/pagination へ昇格して共有する（§5.3 の「昇格は責務名を付ける」）。
 */

// ページ番号の上限。巨大な ?page= を手打ちされたときの OFFSET 肥大
// （深いページの全件走査による DoS）を防ぐ境界制限。実データ規模（数千件÷24）に対し
// 十分広く、悪意ある巨大値だけを弾く（範囲外は呼び出し側で最終ページへ丸められる）。
const MAX_PAGE = 10_000;

/**
 * ?page= の生値を 1..MAX_PAGE の整数ページ番号に丸める。
 * 非数・0・負数・小数・NaN・undefined は 1 に、上限超過は MAX_PAGE に丸める
 * （不正・過大入力でも巨大 OFFSET のクエリを発行させない）。
 */
export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    return 1;
  }
  // 整数のみ受理する（"2.5" や "2abc" は弾く）。
  if (!/^\d+$/.test(value)) {
    return 1;
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < 1) {
    return 1;
  }
  return Math.min(parsed, MAX_PAGE);
}

/** 総件数と 1 ページあたり件数から総ページ数を求める（0 件でも最低 1 ページ）。 */
export function totalPageCount(total: number, pageSize: number): number {
  if (total <= 0) {
    return 1;
  }
  return Math.ceil(total / pageSize);
}
