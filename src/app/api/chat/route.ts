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
// maxOutputTokens・タイムアウト/フォールバックは T15（チャット運用ガード）で扱う。
// ここでは巨大ペイロードを弾く最低限の上限のみを設ける（DESIGN §6.3 の一部を前倒し）。

/** 1 リクエストで受け付けるメッセージ数の上限（往復の暴走・巨大配列を弾く）。 */
const MAX_MESSAGES = 100;

/** 1 メッセージのテキスト総長の上限（巨大テキストの埋め込み・LLM コスト暴走を弾く）。 */
const MAX_MESSAGE_TEXT_LENGTH = 4000;

/** ツール呼び出しを挟むためのステップ上限（searchSake→proposeSake の複数ステップを許可）。 */
const MAX_STEPS = 5;

/**
 * リクエストボディの Zod スキーマ（useChat が送る UIMessage 配列を最低限検証する。
 * 信頼境界の外なので、AI SDK に渡す前に配列長・テキスト長を弾く）。
 *
 * UIMessage の全構造ではなく、DoS ガードに必要な最小限（role・parts のテキスト長）だけを
 * 検証する。詳細構造は AI SDK の convertToModelMessages が扱う。
 */
const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        parts: z.array(
          z.object({
            type: z.string(),
            text: z.string().max(MAX_MESSAGE_TEXT_LENGTH).optional(),
          }),
        ),
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
  const messages = parsed.data.messages as unknown as ChatUIMessage[];

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: async ({ writer }) => {
      const result = streamText({
        model: gateway(CHAT_MODEL_ID),
        system: CHAT_SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages),
        // proposeSake が検証済みカードを writer 経由でデータパートに載せる（捏造防止の要）。
        tools: createChatTools({ writer }),
        // searchSake→proposeSake のツール往復を許可（1 ステップでは提案まで到達しない）。
        stopWhen: stepCountIs(MAX_STEPS),
      });
      // LLM のテキスト・ツール往復のストリームを、writer が書く data part と統合する。
      writer.merge(result.toUIMessageStream());
    },
    // サーバ内部エラーの詳細をクライアントへ漏らさない（DESIGN §6.2）。
    // AI SDK 呼び出しの詳細ログはサーバ側でのみ出す（message のみ・レスポンス本文は出さない）。
    onError: (error) => {
      console.error(
        "[api/chat] streamText error:",
        error instanceof Error ? error.message : "unknown error",
      );
      return "チャットの応答生成でエラーが発生しました。時間をおいて再度お試しください。";
    },
  });

  return createUIMessageStreamResponse({ stream });
}
