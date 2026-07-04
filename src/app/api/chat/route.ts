import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  gateway,
} from "ai";
import { z } from "zod";

import { CHAT_MODEL_ID } from "@/lib/ai/models";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai/prompts";

import { stripAssistantDataParts } from "./_lib/strip-data-parts";
import { type ChatUIMessage, createChatTools } from "./_lib/tools";

/**
 * RAG チャットの唯一の Route Handler（DESIGN §5.1・§4.3・TASKS T14 ①）。
 *
 * フロー: Zod 入力検証 → createUIMessageStream（writer 付き）→ streamText
 *   （AI Gateway 経由 Claude Haiku 4.5・CHAT_SYSTEM_PROMPT・searchSake/proposeSake ツール）。
 * proposeSake ツールが返した銘柄 ID を validateProposedSakeIds で **DB 存在検証**してから
 * 「検証済みカード」をデータパート（data-proposedSakes）で送る（実在しない ID は黙って除外）。
 * これで LLM の自由文をカードにせず、ハルシネーション表示を構造的に防ぐ（DESIGN §6.2）。
 *
 * ステートレス設計（DESIGN §2.6・決定 D4）: 会話状態はクライアント（useChat）が保持し、
 * 毎リクエストで全履歴を送る。認証は不要（匿名でチャット可）。ログイン時の確定提案の
 * chat_sessions への保存は T15 のスコープ（本タスクは基本フロー＋捏造防止に集中）。
 *
 * 注意（DIRECTORY_STRUCTURE §5.2）: AI SDK（`ai`）の import はここと src/lib/ai のみに許可。
 * gateway プロバイダは AI_GATEWAY_API_KEY を実行時に参照するため、import・build では
 * キーを要求しない（未設定でも build は壊れない。実際の LLM 呼び出し時にエラーになる）。
 */

// AI 呼び出しはリクエスト時に行うため動的レンダリング（キャッシュしない）。
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 入力検証の安全上限（最低限の DoS ガード。T14 スコープ）
// ---------------------------------------------------------------------------
//
// 会話往復数の詳細な上限・メッセージ長ごとの精緻なコスト上限・レート制限・
// タイムアウト/フォールバック・chat_sessions 保存・maxDuration は T15
// （チャット運用ガード）で扱う。ここでは巨大ペイロードを弾く最低限の上限と、
// 出力トークンの有界化（S-2）だけを設ける（DESIGN §6.3 の一部を前倒し）。

/** 1 リクエストで受け付けるメッセージ数の上限（往復の暴走・巨大配列を弾く）。 */
const MAX_MESSAGES = 100;

/** 1 メッセージあたりの part 要素数の上限（大量 part を詰める増幅 DoS の最低限ガード。S-3）。 */
const MAX_PARTS_PER_MESSAGE = 50;

/** 1 メッセージのテキスト総長の上限（巨大テキストの埋め込み・LLM コスト暴走を弾く）。 */
const MAX_MESSAGE_TEXT_LENGTH = 4000;

/** ツール呼び出しを挟むためのステップ上限（searchSake→proposeSake の複数ステップを許可）。 */
const MAX_STEPS = 5;

/** LLM 出力トークンの上限（出力側コスト DoS を有界化。S-2。DESIGN §6.3 の前倒し）。 */
const MAX_OUTPUT_TOKENS = 1024;

/**
 * リクエストボディの Zod スキーマ（useChat が送る UIMessage 配列を最低限検証する。
 * 信頼境界の外なので、AI SDK に渡す前に配列長・要素数・テキスト長を弾く）。
 *
 * - role は user / assistant のみ許可する（S-1）。system はクライアントから注入させず、
 *   常にサーバが CHAT_SYSTEM_PROMPT で組み立てる（プロンプト乗っ取り防止）。
 * - part は `type` と任意の `text` だけを検証する。**未知キー（data 等）は Zod が strip する**
 *   ため、クライアントが偽装した data-* パートはこの検証を通過できず LLM/描画に到達しない
 *   （偽装カードの流入防止。S-4 と併せた多層防御）。過去 assistant の正規 data-* パートは
 *   後段の stripAssistantDataParts で明示的に落とす（strip の暗黙挙動に依存しない）。
 */
const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        parts: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().max(MAX_MESSAGE_TEXT_LENGTH).optional(),
            }),
          )
          .max(MAX_PARTS_PER_MESSAGE),
      }),
    )
    .min(1)
    .max(MAX_MESSAGES),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "リクエストボディが不正です。" },
      { status: 400 },
    );
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "メッセージの形式または長さが不正です。" },
      { status: 400 },
    );
  }

  // 検証済みボディを UIMessage として扱う（Zod は最小限の検証で、詳細型は AI SDK に委ねる）。
  // 過去 assistant の data-* パート（提案カード等）は信頼境界外の echo なので LLM へ渡す前に落とす（S-4）。
  const messages = stripAssistantDataParts(
    parsed.data.messages as unknown as ChatUIMessage[],
  );

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: async ({ writer }) => {
      const result = streamText({
        model: gateway(CHAT_MODEL_ID),
        system: CHAT_SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages),
        // 出力トークンを有界化して出力側コスト DoS を防ぐ（S-2）。
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // proposeSake が検証済みカードを writer 経由でデータパートに載せる（捏造防止の要）。
        tools: createChatTools({ writer }),
        // searchSake→proposeSake のツール往復を許可（1 ステップでは提案まで到達しない）。
        stopWhen: stepCountIs(MAX_STEPS),
      });
      // LLM のテキスト・ツール往復のストリームを、writer が書く data part と統合する。
      writer.merge(result.toUIMessageStream());
    },
    // エラー処理の責務分担（S-5）: サーバは「message のみログ（レスポンス本文は出さない）」に
    // 徹し、内部詳細をクライアントへ漏らさない（DESIGN §6.2）。**ユーザー向けの文言は UI
    // （chat-container）の固定文言が単一情報源**であり、ここが返すエラーパートのテキストは
    // 画面には出さない（useChat は error オブジェクトの有無で自前文言を表示する）。ストリームに
    // エラーが載ったことを UI が検知できるよう一般的なマーカー文言のみ返す（内部情報を含めない）。
    onError: (error) => {
      console.error(
        "[api/chat] streamText error:",
        error instanceof Error ? error.message : "unknown error",
      );
      return "error";
    },
  });

  return createUIMessageStreamResponse({ stream });
}
