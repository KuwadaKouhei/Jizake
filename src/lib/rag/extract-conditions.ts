import { PREFECTURES } from "@/lib/constants/prefectures";

/**
 * クエリ自然文からの粗い検索条件抽出（純関数・DB / LLM 非依存）。
 *
 * 役割分担（DESIGN §2.6）: ヒアリング回答→検索条件への高度な変換は generator（T14）の
 * searchSake ツールが LLM で行う。retriever（本層）は「渡された条件＋クエリ文字列」で
 * 動く最小限だけを担う。ここは LLM 不在でも動く保険として、既知のタグ名・都道府県名が
 * 自然文に**素直に含まれている**場合だけを部分一致で拾う（形態素解析等はしない）。
 *
 * 純関数なのでユニットテスト対象（TEST_PHILOSOPHY）。retriever の freeText/明示条件と
 * 組み合わせて使うことを想定し、ここ自体は DB を引かない。
 */

/**
 * 自然文から既知タグ名を部分一致で抽出する。
 *
 * - knownTagNames は呼び出し側（DB のタグ一覧）から渡す（このモジュールはタグを知らない）。
 * - 空白のみ・空文字のタグ名は無視する（誤って全一致しないよう防御）。
 * - 返り値は入力 knownTagNames の順序を保ち、重複は畳む。
 */
export function extractTagNames(
  text: string,
  knownTagNames: readonly string[],
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const name of knownTagNames) {
    const trimmed = name.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    if (text.includes(trimmed)) {
      seen.add(trimmed);
      found.push(trimmed);
    }
  }
  return found;
}

/**
 * 自然文から都道府県 JIS コードを 1 件抽出する（最初に一致した県名。無ければ undefined）。
 *
 * 県名は「山口県」「山口」の両表記を許容するため、末尾の「都/道/府/県」を落とした
 * 基底名でも一致させる。retriever の prefectureCode は単一（DESIGN §5.3）なので
 * 最初の一致のみを返す。PREFECTURES の並び順（JIS コード順）で先勝ちにし決定的にする。
 */
export function extractPrefectureCode(text: string): string | undefined {
  for (const prefecture of PREFECTURES) {
    const base = prefecture.name.replace(/[都道府県]$/u, "");
    if (
      text.includes(prefecture.name) ||
      (base.length > 0 && text.includes(base))
    ) {
      return prefecture.code;
    }
  }
  return undefined;
}
