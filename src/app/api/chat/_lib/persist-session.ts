import { getCurrentUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import type { CatalogDb, SakeSummary } from "@/lib/db/queries/sakes";
import { chatMessages, chatSessions } from "@/lib/db/schema";

import type { ChatUIMessage } from "./tools";

/**
 * ログインユーザーの確定提案セッション保存（TASKS T15 ④・DESIGN §2.6・§4.3・決定 D4）。
 *
 * 決定 D4: チャットはステートレス（クライアント保持）で、**ログインユーザーが確定提案を
 * 受けた会話のみ** chat_sessions / chat_messages に保存する（匿名は保存しない。推薦の入力・
 * 振り返り用）。
 *
 * 保存タイミング/粒度（REVIEW T15 S-1/S-2）: 保存は streamText の **onFinish で 1 リクエスト
 * につき 1 回だけ**行う（1 会話 = 1 セッション）。proposeSake の execute では検証済み提案を
 * リクエストスコープに蓄積するだけで保存しない。これにより
 *   (a) proposeSake が複数回呼ばれても chat_sessions は 1 行（D4・レート制限カウント二重増加を防ぐ）
 *   (b) 保存する assistant 本文が「確定した応答テキスト（提案理由）」になる（合成固定文言にならない）
 *   (c) 保存の DB I/O がストリーム経路から外れる（レスポンス返却後に after で完遂）
 * を満たす。
 *
 * 保存内容（DATABASE §2.8/§2.9）:
 * - chat_sessions: user_id（サーバセッション由来を強制）。
 * - chat_messages: これまでの会話（user / assistant の text メッセージ）＋確定した最終応答本文を
 *   時系列で保存。確定提案を含む末尾 assistant メッセージに proposed_sake_ids
 *   （**validateProposedSakeIds を通した検証済み ID のみ・重複排除**。CHECK: assistant 限定）を
 *   非正規化して持つ（決定 DB-6）。
 *
 * user_id 二段防御（DESIGN §6.2 / 履歴記録と同じ姿勢）:
 * - 主防御（一段目）: 公開関数 saveConfirmedProposal は user_id を引数で受けず、必ず
 *   getCurrentUser（認証セッション）から取得する。他人のセッションに書ける経路を露出しない。
 * - 二段目: chat_sessions / chat_messages の RLS（本人限定。DATABASE §4.2）。
 *
 * 保存の失敗はチャット応答（ストリーム）に影響させない（履歴記録 T09 と同様、握りつぶさず
 * ログは必ず出す）。DB 非依存の抽出は純関数に分離してテストする。
 */

/** chat_messages に保存するメッセージ 1 件（role と本文、任意の検証済み提案 ID）。 */
export type PersistableMessage = {
  role: "user" | "assistant";
  content: string;
  /** DB 存在検証済みの提案銘柄 ID（assistant のみ・提案があるメッセージのみ）。 */
  proposedSakeIds?: string[];
};

/** 順序を保った重複排除（最初の出現位置を保持）。 */
function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * 会話履歴＋確定応答本文を chat_messages 保存用のレコードに変換する（純関数）。
 *
 * - 入力 messages（クライアントが送ってきた履歴）の user / assistant の text を連結して content にする。
 *   data-* 等の非 text パートは保存しない（content はプレーンテキスト。DATABASE §2.9）。
 * - text が空のメッセージ（提案カードのみ等）は content が必須のためスキップする。
 * - finalAssistantText（onFinish が持つ**確定した最終応答テキスト**）が非空なら、末尾に
 *   assistant メッセージとして追加する。ステートレスでは in-flight の assistant 応答が入力
 *   messages に無い（末尾が user のことが多い）ため、確定本文をここで補って提案理由を残す。
 * - 検証済み提案 ID（重複排除済み）は「末尾の assistant メッセージ」に付与する。assistant が
 *   1 件も無ければ合成の assistant を足して提案 ID を載せる（提案を取りこぼさない）。
 *
 * proposedSakeIds は SakeSummary の id（DB 存在検証済み）だけを載せる（捏造 ID は入らない）。
 */
export function buildPersistableMessages(
  messages: readonly ChatUIMessage[],
  proposedSakeIds: readonly string[],
  finalAssistantText = "",
): PersistableMessage[] {
  const records: PersistableMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = message.parts
      .filter(
        (part): part is Extract<typeof part, { type: "text" }> =>
          part.type === "text" && typeof part.text === "string",
      )
      .map((part) => part.text)
      .join("");
    if (content.length === 0) continue;
    records.push({ role: message.role, content });
  }

  // 確定した最終応答（提案理由テキスト）を末尾 assistant として補う（in-flight 対策）。
  const finalText = finalAssistantText.trim();
  if (finalText.length > 0) {
    records.push({ role: "assistant", content: finalText });
  }

  const ids = dedupe(proposedSakeIds);
  if (ids.length === 0) {
    return records;
  }

  // 確定提案 ID を末尾の assistant メッセージに付ける。無ければ合成の assistant を足す。
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].role === "assistant") {
      records[i] = { ...records[i], proposedSakeIds: ids };
      return records;
    }
  }
  records.push({
    role: "assistant",
    content: "（提案）",
    proposedSakeIds: ids,
  });
  return records;
}

/**
 * 会話と確定提案を保存する（db・userId を明示的に受ける下位関数）。
 * テストでは PGlite を差し込むためにこちらを直接呼ぶ。
 *
 * chat_sessions を 1 行作成し、buildPersistableMessages の結果を chat_messages に一括 INSERT する。
 * 提案 ID が 1 件も無ければ「確定提案なし」なので保存しない（決定 D4: 確定提案のみ保存）。
 */
export async function insertConfirmedSession(
  db: CatalogDb,
  userId: string,
  messages: readonly ChatUIMessage[],
  proposedSakeIds: readonly string[],
  finalAssistantText = "",
): Promise<void> {
  if (proposedSakeIds.length === 0) {
    return;
  }
  const records = buildPersistableMessages(
    messages,
    proposedSakeIds,
    finalAssistantText,
  );
  if (records.length === 0) {
    return;
  }

  const [session] = await db
    .insert(chatSessions)
    .values({ userId })
    .returning({ id: chatSessions.id });

  await db.insert(chatMessages).values(
    records.map((record) => ({
      sessionId: session.id,
      role: record.role,
      content: record.content,
      proposedSakeIds: record.proposedSakeIds ?? null,
    })),
  );
}

/**
 * ログインユーザーの確定提案セッションを保存する公開関数（route.ts の onFinish から 1 回呼ぶ）。
 *
 * user_id は認証セッションから強制取得する（主防御。引数で受けない）。匿名は保存しない
 * （決定 D4）。保存の失敗はチャット応答に影響させない（ログのみ・握りつぶさない）。
 *
 * @param messages 会話の全履歴（クライアントが送ってきた UIMessage 配列）
 * @param verified DB 存在検証済みの提案銘柄（全 proposeSake 呼び出し分をマージ・重複可）
 * @param finalAssistantText 確定した最終応答テキスト（onFinish の event.text。提案理由）
 */
export async function saveConfirmedProposal(
  messages: readonly ChatUIMessage[],
  verified: readonly SakeSummary[],
  finalAssistantText = "",
): Promise<void> {
  if (verified.length === 0) {
    return;
  }
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return;
  }
  if (!user) {
    // 匿名は保存しない（決定 D4）。
    return;
  }

  try {
    await insertConfirmedSession(
      getDb(),
      user.id,
      messages,
      verified.map((sake) => sake.id),
      finalAssistantText,
    );
  } catch (error) {
    console.error(
      "[api/chat] failed to persist chat session:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
