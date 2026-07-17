import type { ChatUIMessage } from "./tools";

/**
 * LLM に渡す前に、過去メッセージの「信頼できない echo パート」を除去する純関数
 * （レビュー S-4・2 往復目クラッシュ修正）。
 *
 * クライアントはステートレスで毎回全履歴を送るため、過去 assistant メッセージに含まれる
 * 以下は「信頼できない echo」（クライアントが細工できる）であり、LLM へ再送しない:
 *
 * - **`data-*`**（`data-proposedSakes` 等）: 検証済み提案カード。既に表示済みで LLM への
 *   再送は不要。細工された data part を LLM コンテキストへ入れない（レビュー S-4）。
 * - **`tool-*`**（`tool-searchSake` 等）: ツール呼び出しと検索結果。落とす理由は 2 つ。
 *   1. **正しさ**: route.ts の Zod スキーマは part を `{ type, text? }` だけで検証し
 *      **未知キー（toolCallId/state/input/output）を strip する**ため、届く tool-* は
 *      `{ type: "tool-searchSake" }` の抜け殻。これを convertToModelMessages に渡すと
 *      toolCallId/input を欠いた tool-call が生成され AI_InvalidPromptError で落ちる
 *      （2 往復目が必ず失敗する原因だった）。
 *   2. **セキュリティ**: 仮に tool-* を検証して保持すると、クライアントが「検索結果」を
 *      偽装して LLM の自由文を誘導できる（DESIGN §6.2 プロンプトインジェクション対策に反する）。
 *
 * text 等の通常パートは保持するため会話の文脈は保たれ、LLM は必要なら再検索する
 * （ステートレス設計・決定 D4 と整合）。
 *
 * DB・AI 非依存の純関数。ユニットテストで「data-* / tool-* が LLM 材料に混ざらない」ことを固定する。
 * route.ts（Route Handler）から export すると Next.js が不正なルートエントリと解釈するため、
 * この _lib に切り出す（DIRECTORY_STRUCTURE §3: api/chat/_lib はチャット専用ロジック）。
 */
export function stripUntrustedAssistantParts(
  messages: ChatUIMessage[],
): ChatUIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.filter(
      (part) =>
        !part.type.startsWith("data-") && !part.type.startsWith("tool-"),
    ) as ChatUIMessage["parts"],
  }));
}
