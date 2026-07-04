import type { ChatUIMessage } from "./tools";

/**
 * チャットのコスト上限ガード（TASKS T15 ①・DESIGN §6.3・§4.3）。
 *
 * ステートレス設計（DESIGN §2.6・決定 D4）ではリクエストごとに会話の全履歴が送られる。
 * LLM を呼ぶ前に「会話が長くなりすぎていないか（往復数上限）」を純関数で判定し、上限超過なら
 * LLM を呼ばずに検索ページへの誘導を返してコストの暴走を止める（変動費は LLM のみ。DESIGN §6.3）。
 *
 * ここは AI SDK・DB に依存しない純関数・定数のみ（TEST_PHILOSOPHY: 上限判定を厚くユニットテスト）。
 * メッセージ長上限（MAX_MESSAGE_TEXT_LENGTH）・part 数上限・maxOutputTokens は route.ts の
 * Zod スキーマ／streamText 側で扱う（入力・出力トークンの有界化）。本ファイルは会話往復数を担う。
 */

/**
 * 1 会話で許容する往復数の上限（初期 10。DESIGN §6.3）。
 *
 * 「往復」は user → assistant の 1 応答を 1 とする。ステートレスで毎回全履歴が届くため、
 * 会話の往復数は履歴内の **user ロールメッセージ数**で数える（assistant 応答は user 発話に
 * 1 対 1 で続くため user 発話数＝これまでの往復数と一致する。ツール往復は 1 リクエスト内で
 * 完結し履歴上の user メッセージを増やさないので、往復数の水増しにならない）。
 */
export const MAX_CONVERSATION_TURNS = 10;

/** コスト上限超過時にユーザーへ返す誘導文言（単一情報源。UI もこの文言を表示する）。 */
export const TURN_LIMIT_MESSAGE =
  "会話が長くなりました。検索ページで条件を指定して探してみてください。";

/**
 * 履歴内の user ロールメッセージ数を数える（＝これまでの会話往復数）。
 *
 * 今回のリクエストで新たに追加された user 発話も含む（送信された全履歴が対象）。
 */
export function countUserTurns(messages: readonly ChatUIMessage[]): number {
  return messages.reduce(
    (total, message) => (message.role === "user" ? total + 1 : total),
    0,
  );
}

/**
 * 会話往復数が上限を超えているか（純関数）。
 *
 * 上限「超過」で誘導へ倒す（MAX_CONVERSATION_TURNS 回目の user 発話までは応答し、
 * それを超える 11 回目の送信で誘導へ倒す）。`turns >= MAX` ではなく `turns > MAX` を使い、
 * ちょうど上限回までは会話を続けられるようにする。
 */
export function exceedsConversationLimit(
  messages: readonly ChatUIMessage[],
): boolean {
  return countUserTurns(messages) > MAX_CONVERSATION_TURNS;
}
