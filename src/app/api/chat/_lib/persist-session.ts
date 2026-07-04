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
 * 振り返り用）。保存は proposeSake が検証済みカードを送る時点で 1 回だけ行う（1 会話 = 1 セッション）。
 *
 * 保存内容（DATABASE §2.8/§2.9）:
 * - chat_sessions: user_id（サーバセッション由来を強制）。
 * - chat_messages: これまでの会話（user / assistant の text メッセージ）を時系列で保存。
 *   確定提案を含む assistant メッセージに proposed_sake_ids（**validateProposedSakeIds を通した
 *   検証済み ID のみ**。CHECK: assistant 限定）を非正規化して持つ（決定 DB-6）。
 *
 * user_id 二段防御（DESIGN §6.2 / 履歴記録と同じ姿勢）:
 * - 主防御（一段目）: 公開関数 saveConfirmedProposal は user_id を引数で受けず、必ず
 *   getCurrentUser（認証セッション）から取得する。他人のセッションに書ける経路を露出しない。
 * - 二段目: chat_sessions / chat_messages の RLS（本人限定。DATABASE §4.2）。
 *
 * 保存の失敗はチャット応答（ストリーム）に影響させない（fire-and-forget と同じ姿勢。
 * 履歴記録 T09 と同様、握りつぶさずログは必ず出す）。DB 非依存の抽出は純関数に分離してテストする。
 */

/** chat_messages に保存するメッセージ 1 件（role と本文、任意の検証済み提案 ID）。 */
export type PersistableMessage = {
  role: "user" | "assistant";
  content: string;
  /** DB 存在検証済みの提案銘柄 ID（assistant のみ・提案があるメッセージのみ）。 */
  proposedSakeIds?: string[];
};

/**
 * UIMessage 配列を chat_messages 保存用のレコードに変換する（純関数）。
 *
 * - user / assistant の text パートを連結して content にする。data-* 等の非 text パートは
 *   保存しない（content はプレーンテキスト。DATABASE §2.9）。
 * - text が空のメッセージ（提案カードのみ等）は content が必須のためスキップする。
 * - 検証済み提案 ID は「最後の assistant メッセージ」に付与する（確定提案は会話末尾の応答に紐づく）。
 *   assistant メッセージが履歴に無い場合（LLM 応答前に proposeSake が走る等の異常系）は
 *   合成の assistant メッセージを 1 件足して提案 ID を載せる（提案を取りこぼさない）。
 *
 * proposedSakeIds は SakeSummary の id（DB 存在検証済み）だけを載せる（捏造 ID は入らない）。
 */
export function buildPersistableMessages(
  messages: readonly ChatUIMessage[],
  proposedSakeIds: readonly string[],
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

  const ids = [...proposedSakeIds];
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
): Promise<void> {
  if (proposedSakeIds.length === 0) {
    return;
  }
  const records = buildPersistableMessages(messages, proposedSakeIds);
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
 * ログインユーザーの確定提案セッションを保存する公開関数。
 *
 * user_id は認証セッションから強制取得する（主防御。引数で受けない）。匿名は保存しない
 * （決定 D4）。保存の失敗はチャット応答に影響させない（ログのみ・握りつぶさない）。
 *
 * @param messages 会話の全履歴（ストリーム時点の UIMessage 配列）
 * @param verified DB 存在検証済みの提案銘柄（validateProposedSakeIds の戻り値）
 */
export async function saveConfirmedProposal(
  messages: readonly ChatUIMessage[],
  verified: readonly SakeSummary[],
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
    );
  } catch (error) {
    console.error(
      "[api/chat] failed to persist chat session:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
