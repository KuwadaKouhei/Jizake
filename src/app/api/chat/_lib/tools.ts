import { tool, type UIMessage, type UIMessageStreamWriter } from "ai";
import { z } from "zod";

import { MAX_PROPOSED_CANDIDATES } from "@/lib/ai/prompts";
import type { SakeSummary } from "@/lib/db/queries/sakes";
import { retrieve as defaultRetrieve } from "@/lib/rag/retriever";
import { validateProposedSakeIds as defaultValidateProposedSakeIds } from "@/lib/rag/validate-proposed";

import { saveConfirmedProposal as defaultSaveConfirmedProposal } from "./persist-session";

/**
 * RAG チャットの generator が使うツール定義（DESIGN §2.6・TASKS T14 ②）。
 *
 * - searchSake: LLM がヒアリング回答を検索条件に変換して retriever（src/lib/rag）を呼ぶ。
 *   結果（DB 実在 ID 付き候補）を tool result として LLM に返す。これが「LLM に渡す
 *   候補は DB 実在 ID のみ」という捏造防止の一段目（DESIGN §2.6）。
 * - proposeSake: 提案確定時に structured output（Zod スキーマ）で銘柄 ID 配列＋理由を受け、
 *   **サーバ側で validateProposedSakeIds により DB 存在検証**してから、検証済みカードだけを
 *   ストリームのデータパートに載せる。実在しない ID は黙って除外する（捏造防止の二段目）。
 *
 * ツールは `createChatTools` で生成する。retriever / validator / writer を注入口にし、
 * generator のユニットテストでは実 API を叩かずにこれらを差し替えて挙動を検証する
 * （TEST_PHILOSOPHY: LLM/埋め込み API はモック、retriever・ID 検証は本物 or フェイクを注入）。
 *
 * 注意（DIRECTORY_STRUCTURE §5.2）: AI SDK（`ai`）の import は src/lib/ai と
 * src/app/api/chat 配下のみに許可される。本ファイルは api/chat/_lib のため許可範囲内。
 */

// ---------------------------------------------------------------------------
// カスタムデータパートの型（サーバ→クライアントに検証済みカードを送る境界）
// ---------------------------------------------------------------------------

/**
 * proposeSake が DB 存在検証を通した「検証済み提案カード」1 組のデータ。
 * ストリームの data part（`data-proposedSakes`）として送り、UI は sake-card で描画する。
 * ここに載るのは validateProposedSakeIds を通過した実在銘柄のみ（DESIGN §6.2:
 * LLM の自由文をカードにしないため、ハルシネーション表示は構造的に不可能）。
 */
export type ProposedSakesData = {
  /** 検証済みの提案銘柄（カード表示・/sake/[id] リンクに必要な要約）。 */
  sakes: SakeSummary[];
};

/**
 * コスト上限超過・LLM 障害時にサーバが送る「フォールバック導線」データ（T15 ①③・DESIGN §6.3/§6.4）。
 * UI は message（誘導文言）を表示し、searchHref（必ず内部の /search 始まり）を検索リンクにする。
 */
export type FallbackData = {
  /** ユーザー向けの誘導文言（コスト上限超過・タイムアウト等）。 */
  message: string;
  /** ヒアリング内容から組み立てた検索誘導 href（内部パス。省略時は導線なし）。 */
  searchHref?: string;
};

/**
 * RAG チャットで使う UIMessage 型（custom data part を型付けする）。
 * サーバ（route.ts）とクライアント（useChat）で共有し、data part の
 * ペイロード型を一致させる（AI SDK v6 の UIMessage ジェネリクスに data 型を渡す）。
 */
export type ChatUIMessage = UIMessage<
  never,
  { proposedSakes: ProposedSakesData; fallback: FallbackData }
>;

/** custom data part の type 名（AI SDK は `data-<name>` を予約プレフィックスにする）。 */
export const PROPOSED_SAKES_DATA_TYPE = "data-proposedSakes" as const;

/** フォールバック導線の data part type 名。 */
export const FALLBACK_DATA_TYPE = "data-fallback" as const;

// ---------------------------------------------------------------------------
// searchSake の入力・出力（境界の型検証）
// ---------------------------------------------------------------------------

/**
 * searchSake の入力スキーマ。LLM がヒアリング内容から詰める検索条件。
 * retriever（RetrieveQuery）に対応するが、信頼境界の外なので Zod で厳格に検証する。
 * すべて任意（ヒアリング途中でも一部条件だけで検索できる）。
 */
const searchSakeInputSchema = z.object({
  freeText: z
    .string()
    .optional()
    .describe(
      "ユーザーの好みを表す自然文（味わい・シーンなど）。ベクタ検索に使う",
    ),
  tagNames: z
    .array(z.string())
    .optional()
    .describe("味タグ名の配列（例: 辛口・華やか）。複数指定は AND 絞り込み"),
  prefectureCode: z
    .string()
    .optional()
    .describe("都道府県の JIS コード（2 桁。例: 山口=35）"),
  priceRange: z.string().optional().describe("価格帯区分"),
});

/** LLM へ返す候補 1 件（tool result）。実在 sakeId を必ず含む。 */
export type SearchSakeResultItem = {
  sakeId: string;
  name: string;
  breweryName: string;
  prefectureCode: string;
  tagNames: string[];
};

// ---------------------------------------------------------------------------
// proposeSake の入力（structured output の境界検証）
// ---------------------------------------------------------------------------

/**
 * proposeSake の入力スキーマ（structured output の境界。捏造防止の本番スキーマ）。
 *
 * LLM は searchSake の検索結果にある銘柄の ID と一言理由を返す。スキーマ適合でも
 * 実在しない ID は後段の validateProposedSakeIds で落ちる（二段構えの二段目）。
 *
 * ドリフト注意（PHIL S-1）: `scripts/lib/rag-eval/fabrication-guard.test.ts` は scripts が
 * src/app を import できない（DIRECTORY_STRUCTURE §5.2）ため、このスキーマと**同一構造**の
 * PoC 雛形を別に持つ。**この本番スキーマそのものでの捏造防止 E2E は `tools.test.ts`** が担う。
 * 構造を変えるときは両者（fabrication-guard.test.ts の雛形・tools.test.ts）を必ず追随させる。
 */
export const proposeSakeInputSchema = z.object({
  proposals: z
    .array(
      z.object({
        sakeId: z
          .string()
          .describe("提案する銘柄の ID（searchSake の結果に含まれるもの）"),
        reason: z
          .string()
          .min(1)
          .describe(
            "その銘柄を勧める一言理由（検索結果の説明・タグの範囲で述べる）",
          ),
      }),
    )
    .min(1)
    .describe("提案する銘柄のリスト（優先度の高い順）"),
});

// ---------------------------------------------------------------------------
// ツール生成（依存を注入してテスト可能にする）
// ---------------------------------------------------------------------------

/** retriever の注入口（本番は src/lib/rag の retrieve、テストはフェイク）。 */
export type RetrieveFn = typeof defaultRetrieve;

/** DB 存在検証の注入口（本番は validateProposedSakeIds、テストはフェイク）。 */
export type ValidateProposedSakeIdsFn = typeof defaultValidateProposedSakeIds;

/** 確定提案セッション保存の注入口（本番は saveConfirmedProposal、テストはフェイク）。 */
export type SaveConfirmedProposalFn = typeof defaultSaveConfirmedProposal;

export type CreateChatToolsDeps = {
  /** 検証済みカードのデータパートを書き込むストリームライタ。 */
  writer: UIMessageStreamWriter<ChatUIMessage>;
  /**
   * 保存対象の会話履歴（このリクエストで受け取った全メッセージ。ステートレスで毎回全履歴が来る）。
   * proposeSake が確定提案を送る時点で、この履歴＋検証済み ID を chat_sessions に保存する（T15 ④）。
   */
  messages?: readonly ChatUIMessage[];
  /** ハイブリッド検索（既定は本番 retriever）。 */
  retrieve?: RetrieveFn;
  /** 提案 ID の DB 存在検証（既定は本番 validateProposedSakeIds）。 */
  validateProposedSakeIds?: ValidateProposedSakeIdsFn;
  /** 確定提案の DB 保存（既定は本番 saveConfirmedProposal。ログイン時のみ・匿名は no-op）。 */
  saveConfirmedProposal?: SaveConfirmedProposalFn;
};

/**
 * チャットの generator に渡すツール群を生成する。
 *
 * searchSake は retriever を呼び候補を LLM に返す。proposeSake は DB 存在検証を通した
 * 検証済みカードだけを writer 経由でデータパートに載せ、tool result には「何件を提示したか」
 * だけを返す（LLM の自由文をカードにしない）。実在しない ID は黙って除外する。
 */
export function createChatTools({
  writer,
  messages = [],
  retrieve = defaultRetrieve,
  validateProposedSakeIds = defaultValidateProposedSakeIds,
  saveConfirmedProposal = defaultSaveConfirmedProposal,
}: CreateChatToolsDeps) {
  return {
    searchSake: tool({
      description:
        "ヒアリングで分かった好みを検索条件に変換し、アプリの日本酒データベースから候補を検索する。提案してよいのはここで返る銘柄だけ。",
      inputSchema: searchSakeInputSchema,
      async execute(input): Promise<{ candidates: SearchSakeResultItem[] }> {
        const candidates = await retrieve({
          freeText: input.freeText,
          tagNames: input.tagNames,
          prefectureCode: input.prefectureCode,
          priceRange: input.priceRange,
          limit: MAX_PROPOSED_CANDIDATES,
        });
        // LLM には ID と名前・産地・タグだけを返す（スコア等の内部値は渡さない）。
        return {
          candidates: candidates.map((c) => ({
            sakeId: c.sake.id,
            name: c.sake.name,
            breweryName: c.sake.breweryName,
            prefectureCode: c.sake.prefectureCode,
            tagNames: c.sake.tags.map((t) => t.name),
          })),
        };
      },
    }),

    proposeSake: tool({
      description:
        "提案が固まったら、searchSake の結果にある銘柄の ID と一言理由を返す。ここで返した ID はサーバ側で存在検証され、実在する銘柄だけがカードとして表示される。",
      inputSchema: proposeSakeInputSchema,
      async execute(input): Promise<{ proposedCount: number }> {
        const ids = input.proposals.map((p) => p.sakeId);
        // 捏造防止の二段目: DB 存在検証で実在銘柄のみに絞る（存在しない ID は除外）。
        const verified = await validateProposedSakeIds(ids);

        // 検証済みカードをデータパートとしてストリームに載せる（UI は sake-card で描画）。
        if (verified.length > 0) {
          writer.write({
            type: PROPOSED_SAKES_DATA_TYPE,
            data: { sakes: verified },
          });

          // 確定提案セッションの保存（T15 ④・決定 D4）: ログインユーザーの確定提案のみ
          // chat_sessions/chat_messages へ検証済み ID とともに保存する。匿名は no-op。
          // 保存失敗は応答（ストリーム）に影響させない（saveConfirmedProposal がログのみで吸収）。
          await saveConfirmedProposal(messages, verified);
        }

        // LLM には検証を通った件数だけを返す（0 件なら条件緩和を促すため 0 を渡す）。
        return { proposedCount: verified.length };
      },
    }),
  };
}
