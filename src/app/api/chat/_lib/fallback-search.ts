import { PREFECTURES } from "@/lib/constants/prefectures";
import { type SearchCriteria, toSearchQueryString } from "@/lib/search-query";

import type { ChatUIMessage } from "./tools";

/**
 * LLM 障害時フォールバックの検索誘導 URL 組み立て（TASKS T15 ③・DESIGN §6.4）。
 *
 * タイムアウトやエラーで LLM が応答できないとき、ユーザーを手ぶらにしないため、
 * これまでのヒアリング内容（会話履歴の user 発話）から判明した条件（味タグ・都道府県）を
 * 抽出し、`/search?...` の検索 URL を組み立てて UI の導線にする。retriever（タグ検索）・
 * カタログ・推薦は LLM 非依存で生きているため、LLM が全断してもユーザーは検索に流れられる。
 *
 * 安全性（DESIGN §6.2）: 生成するのは必ず内部パス（`/search` ＋クエリ文字列）で、
 * URL は既存の純関数 toSearchQueryString で組む（オープンリダイレクトの余地なし）。
 * 味タグ・都道府県は「アプリが知っている語彙」への完全一致マッチのみ採用し、ユーザー入力を
 * そのまま URL に載せない（q= の自由文はフォールバックでは使わず、既知語彙だけで安全に組む）。
 *
 * ここは AI SDK・DB に依存しない純関数（TEST_PHILOSOPHY: 条件抽出・URL 組み立てをユニットテスト）。
 */

/**
 * フォールバックの条件抽出に使う味タグ語彙。
 *
 * さけのわ 6 軸由来の味タグ（scripts/lib/sakenowa/flavor-to-tags.ts と一致）。scripts は
 * src から import できない（DIRECTORY_STRUCTURE §5.2）ため、フォールバック用の既知語彙として
 * ここに定数で持つ。タグを増やすときは両者を追随させる（DB の taste タグと整合させる）。
 * 完全一致で会話文に含まれるものだけを検索条件に採用する（未知語をそのまま URL に載せない）。
 */
export const KNOWN_TASTE_TAGS = [
  "華やか",
  "芳醇",
  "重厚",
  "穏やか",
  "ドライ",
  "軽快",
] as const;

/** フォールバックで抽出する条件の上限件数（過大な URL・自己 DoS を避ける）。 */
const MAX_FALLBACK_TAGS = 4;

/** 会話履歴から結合する user 発話テキストの上限長（巨大履歴での走査コストを抑える）。 */
const MAX_SCAN_TEXT_LENGTH = 8000;

/**
 * 会話メッセージ列から user 発話のテキストを連結する（純関数）。
 * 提案カード等の data-* パートは含めず、text パートだけを対象にする（信頼できる本文のみ走査）。
 */
export function collectUserText(messages: readonly ChatUIMessage[]): string {
  const chunks: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").slice(0, MAX_SCAN_TEXT_LENGTH);
}

/**
 * 会話履歴のヒアリング内容から検索条件（味タグ・都道府県）を抽出する（純関数）。
 *
 * - 味タグ: 既知語彙（KNOWN_TASTE_TAGS）に完全一致で会話文に含まれるものを採用（AND 絞り込み）。
 * - 都道府県: 県名（PREFECTURES の name。「県/府/都」抜きの短縮形も許容）に一致した最初の 1 件のコード。
 *   **フルネーム一致を短縮形より優先**する（2 パス。例: 会話に「京都府」があれば、短縮「京都」の
 *   部分一致で「東京都」の短縮「東京」を先に拾う等の誤検出を避ける）。
 * - q（自由文）: フォールバックでは使わない（未知語をそのまま URL に載せない安全側の判断）。
 *
 * SEC 注記（REVIEW T15 SEC S-1）: 短縮形マッチは部分一致のため誤プリフィルの余地があるが、
 * ここで組む URL は内部 /search に渡され、/search 側の Zod（prefectureSchema が JIS コードを
 * 再検証）で最終的に再検証・不正値は無視されるため実害は小さい（プリフィルの利便性を優先し許容）。
 *
 * 何も抽出できなければ tagNames=[] / prefectureCode=undefined になり、呼び出し側は素の /search へ誘導する。
 */
export function extractCriteriaFromMessages(
  messages: readonly ChatUIMessage[],
): SearchCriteria {
  const text = collectUserText(messages);

  const tagNames: string[] = [];
  for (const tag of KNOWN_TASTE_TAGS) {
    if (text.includes(tag)) {
      tagNames.push(tag);
      if (tagNames.length >= MAX_FALLBACK_TAGS) break;
    }
  }

  // 1 パス目: フルネーム完全一致を優先（誤検出しにくい）。
  let prefectureCode = PREFECTURES.find((p) => text.includes(p.name))?.code;
  // 2 パス目: フルネームで取れなければ短縮形（県/府/都 抜き）で拾う。
  if (prefectureCode === undefined) {
    for (const prefecture of PREFECTURES) {
      const shortName = prefecture.name.replace(/[都道府県]$/u, "");
      if (shortName.length >= 2 && text.includes(shortName)) {
        prefectureCode = prefecture.code;
        break;
      }
    }
  }

  return { tagNames, prefectureCode, page: 1 };
}

/**
 * フォールバックの検索誘導 href を組み立てる（純関数）。必ず `/search` 始まりの内部パスを返す。
 *
 * 条件が何も取れなければ `/search`（素の検索ページ）を返す。取れれば `/search?tags=…&prefecture=…`。
 * URL 組み立ては既存の toSearchQueryString に委譲する（重複実装を避け、安全なエンコードを共有）。
 */
export function buildFallbackSearchHref(
  messages: readonly ChatUIMessage[],
): string {
  const criteria = extractCriteriaFromMessages(messages);
  return `/search${toSearchQueryString(criteria)}`;
}
