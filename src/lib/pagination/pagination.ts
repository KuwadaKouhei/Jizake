/**
 * ページ番号処理の純関数（一覧・検索で共有）。
 *
 * URL の ?page= は信頼できない外部入力なので、この関数で 1 以上の整数に丸めて
 * 境界検証する。県別一覧（T06）と検索（T07）の 2 機能が同じ規則を必要とし、
 * 機能固有の _lib からパス依存で相互 import すると DIRECTORY_STRUCTURE §5.2
 * 「機能ロジック同士は横に依存しない」に反するため、責務名ディレクトリ
 * src/lib/pagination へ昇格して共有する（§5.3 の「昇格は責務名を付ける」）。
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
