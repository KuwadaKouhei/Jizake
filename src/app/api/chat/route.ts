import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  gateway,
} from "ai";
import { after } from "next/server";
import { z } from "zod";

import { CHAT_MODEL_ID } from "@/lib/ai/models";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { SakeSummary } from "@/lib/db/queries/sakes";

import {
  exceedsConversationLimit,
  TURN_LIMIT_MESSAGE,
} from "./_lib/conversation-guard";
import { buildFallbackSearchHref } from "./_lib/fallback-search";
import { saveConfirmedProposal } from "./_lib/persist-session";
import { isChatRateLimited, RATE_LIMIT_MESSAGE } from "./_lib/rate-limit";
import { stripAssistantDataParts } from "./_lib/strip-data-parts";
import {
  type ChatUIMessage,
  createChatTools,
  FALLBACK_DATA_TYPE,
} from "./_lib/tools";

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
 * 毎リクエストで全履歴を送る。認証は不要（匿名でチャット可）。
 *
 * 運用ガード（TASKS T15・DESIGN §6.3/§6.4）:
 * - コスト上限（①）: 会話往復数上限（超過は LLM を呼ばず検索誘導を返す）・メッセージ長上限
 *   （Zod）・maxOutputTokens。
 * - レート制限（②）: ログインユーザーは 20 会話/日（chat_sessions の当日作成数）。匿名は対象外。
 * - タイムアウト/フォールバック（③）: 30 秒の AbortSignal ＋ maxDuration。障害時はエラーパートに
 *   加えヒアリング内容から組み立てた検索誘導（data-fallback）を送る。
 * - セッション保存（④）: ログイン時の確定提案のみ chat_sessions/chat_messages へ保存（tools.ts 側）。
 *
 * 注意（DIRECTORY_STRUCTURE §5.2）: AI SDK（`ai`）の import はここと src/lib/ai のみに許可。
 * gateway プロバイダは AI_GATEWAY_API_KEY を実行時に参照するため、import・build では
 * キーを要求しない（未設定でも build は壊れない。実際の LLM 呼び出し時にエラーになる）。
 */

// AI 呼び出しはリクエスト時に行うため動的レンダリング（キャッシュしない）。
export const dynamic = "force-dynamic";

// LLM 応答（ストリーミング＋ツール往復）の最大実行時間（秒）。タイムアウト（TIMEOUT_MS）より
// 余裕を持たせ、関数自体が先に打ち切られないようにする（Vercel の maxDuration。DESIGN §6.4）。
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// 入力検証・運用ガードの安全上限（T14 の最低限ガード＋T15 の運用ガード）
// ---------------------------------------------------------------------------

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
 * LLM 呼び出しのタイムアウト（ミリ秒。DESIGN §6.4）。
 *
 * 55 秒（maxDuration 60 秒の範囲内）。初期値 30 秒では、T23 の段階的絞り込みで
 * 1 リクエスト内の LLM ステップ（検索→応答→提案）が増えた結果、正常な応答でも
 * タイムアウトが誤発火してエラー表示が頻発した（実測: 本番ビルドで 1 往復 6〜11 秒、
 * 開発サーバはさらに遅い）ため引き上げた（2026-07-05）。
 */
const TIMEOUT_MS = 55_000;

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

  // コスト上限ガード①（DESIGN §6.3）: 会話が長くなりすぎたら LLM を呼ばず、検索誘導を返す。
  // ステートレスで全履歴が来るため、往復数は user 発話数で判定する（conversation-guard の純関数）。
  if (exceedsConversationLimit(messages)) {
    return fallbackStreamResponse(TURN_LIMIT_MESSAGE, messages);
  }

  // レート制限②（DESIGN §6.3）: ログインユーザーは 20 会話/日。匿名は対象外（決定 D4/D5）。
  // user_id はセッションから強制取得（isChatRateLimited が主防御。引数で受けない）。
  if (await isChatRateLimited()) {
    return fallbackStreamResponse(RATE_LIMIT_MESSAGE, messages);
  }

  const stream = createUIMessageStream<ChatUIMessage>({
    execute: async ({ writer }) => {
      // 確定提案の蓄積先（リクエストスコープ。proposeSake が複数回呼ばれても保存は onFinish の
      // 1 回だけにするための箱。REVIEW T15 S-1/S-2）。
      const collectedProposals: SakeSummary[] = [];

      const result = streamText({
        model: gateway(CHAT_MODEL_ID),
        system: CHAT_SYSTEM_PROMPT,
        messages: await convertToModelMessages(messages),
        // 出力トークンを有界化して出力側コスト DoS を防ぐ（S-2）。
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // タイムアウト③（DESIGN §6.4）: 30 秒で LLM 呼び出しを中断する。中断は onError で
        // ハンドリングし、UI にはフォールバック導線（下）が届く。
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        // proposeSake が検証済みカードを writer 経由でデータパートに載せ、検証済み銘柄を
        // collectedProposals に蓄積する（保存は下の onFinish で 1 回。捏造防止の要は不変）。
        tools: createChatTools({ writer, collectedProposals }),
        // searchSake→proposeSake のツール往復を許可（1 ステップでは提案まで到達しない）。
        stopWhen: stepCountIs(MAX_STEPS),
        // タイムアウト/障害時③: エラーパートに加え、ヒアリング内容から組み立てた検索誘導を送る。
        // ユーザーが手ぶらにならないようにする（retriever・カタログ・検索は LLM 非依存で生存）。
        onError() {
          writer.write({
            type: FALLBACK_DATA_TYPE,
            data: {
              message:
                "ただいまチャットが混み合っています。以下の検索から日本酒をお探しいただけます。",
              searchHref: buildFallbackSearchHref(messages),
            },
          });
        },
        // 応答確定時④（REVIEW T15 S-1/S-2/S-3）: 確定提案が 1 件以上あれば 1 会話 1 セッションで
        // 保存する。event.text は確定した最終応答本文（提案理由）。DB I/O はストリームをブロック
        // しないよう after() でレスポンス返却後に実行する（サーバレスで完遂させる。性能 S-3）。
        // saveConfirmedProposal 内でログイン判定（匿名は no-op）・検証済み ID の重複排除を行う。
        onFinish({ text }) {
          if (collectedProposals.length === 0) return;
          const proposals = collectedProposals.slice();
          after(async () => {
            await saveConfirmedProposal(messages, proposals, text);
          });
        },
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

/**
 * LLM を呼ばずにフォールバック導線だけを 1 パート送るストリーム応答を作る
 * （コスト上限超過①・レート制限超過②）。
 *
 * LLM を一切呼ばないことでコストの暴走を止めつつ、ユーザーには誘導文言＋検索 URL を届けて
 * 手ぶらにしない（DESIGN §6.3/§6.4）。searchHref は必ず内部の /search 始まり（オープン
 * リダイレクトなし）。UI は data-fallback パートを検知して誘導カードを描画する。
 */
function fallbackStreamResponse(
  message: string,
  messages: readonly ChatUIMessage[],
): Response {
  const stream = createUIMessageStream<ChatUIMessage>({
    execute: ({ writer }) => {
      writer.write({
        type: FALLBACK_DATA_TYPE,
        data: { message, searchHref: buildFallbackSearchHref(messages) },
      });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
