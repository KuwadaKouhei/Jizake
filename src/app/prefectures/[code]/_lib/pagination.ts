/**
 * 県別一覧（/prefectures/[code]）専用のページ番号処理（純関数）。
 *
 * URL の ?page= は信頼できない外部入力なので、この画面固有の境界検証として
 * 1 以上の整数に丸める（DIRECTORY_STRUCTURE §3・DIR-6: 機能固有ロジックは _lib へ）。
 */

/**
 * ?page= の生値を 1 始まりの整数ページ番号に丸める。
 * 非数・0・負数・小数・NaN・undefined はすべて 1 に丸める（不正入力は先頭ページ扱い）。
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
  return parsed >= 1 ? parsed : 1;
}

/** 総件数と 1 ページあたり件数から総ページ数を求める（0 件でも最低 1 ページ）。 */
export function totalPageCount(total: number, pageSize: number): number {
  if (total <= 0) {
    return 1;
  }
  return Math.ceil(total / pageSize);
}
