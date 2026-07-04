import type { ChatUIMessage } from "./tools";

/**
 * LLM に渡す前に、過去メッセージの data-* パート（提案カード等）を除去する純関数（レビュー S-4）。
 *
 * クライアントはステートレスで毎回全履歴を送るため、過去 assistant メッセージに含まれる
 * `data-proposedSakes` 等は「信頼できない echo」（クライアントが細工できる）。提案カードは
 * 既に表示済みで LLM への再送は不要なので、convertToModelMessages に渡す前に落として
 * 細工された data part を LLM コンテキストへ入れない。text 等の通常パートは保持する。
 *
 * DB・AI 非依存の純関数。ユニットテストで「data-* が LLM 材料に混ざらない」ことを固定する。
 * route.ts（Route Handler）から export すると Next.js が不正なルートエントリと解釈するため、
 * この _lib に切り出す（DIRECTORY_STRUCTURE §3: api/chat/_lib はチャット専用ロジック）。
 */
export function stripAssistantDataParts(
  messages: ChatUIMessage[],
): ChatUIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter(
      (part) => !part.type.startsWith("data-"),
    ) as ChatUIMessage["parts"],
  }));
}
