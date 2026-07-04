import { and, count, eq, gte } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import type { CatalogDb } from "@/lib/db/queries/sakes";
import { chatSessions } from "@/lib/db/schema";

/**
 * ログインユーザーのチャットレート制限（TASKS T15 ②・DESIGN §6.3）。
 *
 * DB カウントで 1 日あたりのチャット会話回数上限を課す（初期 20 会話/日）。会話数は
 * chat_sessions の当日作成数を user_id で数える（index 8: user_id, created_at DESC を利用）。
 * 匿名ユーザーは chat_sessions を持たない（決定 D4: 匿名は保存しない）ため対象外
 * （匿名の連打対策は先回りしない＝決定 D5。会話往復・長さ・出力上限は匿名にも効く）。
 *
 * user_id 二段防御（DESIGN §6.2 / 履歴クエリと同じ姿勢）:
 * - 主防御（一段目）: 公開関数 isChatRateLimited は user_id を引数で受けず、必ず
 *   getCurrentUser（認証セッション）から取得してカウントする。他人の user_id で
 *   カウントを操作する経路を露出しない。
 * - 二段目: chat_sessions の RLS（本人限定。DATABASE §4.2）。
 *
 * 判定ロジック（isRateLimited）は純関数、DB カウント（countTodaySessions）は下位関数に
 * 分離し、PGlite で統合テストする（TEST_PHILOSOPHY）。
 */

/** 1 日あたりのチャット会話回数上限（初期 20 会話/日。DESIGN §6.3）。 */
export const MAX_SESSIONS_PER_DAY = 20;

/** レート制限超過時にユーザーへ返す誘導文言（単一情報源。UI もこの文言を表示する）。 */
export const RATE_LIMIT_MESSAGE =
  "本日のチャット利用が上限に達しました。検索ページからお探しいただくか、時間をおいてお試しください。";

/**
 * 「その日の 0 時（サーバのローカル日付基準）」の Date を返す（純関数・注入テスト用に now を受ける）。
 *
 * 当日作成分だけを数えるための下限時刻。日付の切り替え基準はサーバのローカルタイムに委ねる
 * （PoC 段階では厳密な TZ 運用は不要。Vercel の実行環境は UTC。運用で JST 起算にしたくなったら
 * ここを 1 箇所直す）。
 */
export function startOfToday(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * 会話数が上限に達しているか（純関数）。
 * 当日の会話数が上限「以上」なら true（今日 20 会話目まで許可し、21 回目の開始を止める）。
 */
export function isRateLimited(
  todaySessionCount: number,
  limit: number = MAX_SESSIONS_PER_DAY,
): boolean {
  return todaySessionCount >= limit;
}

/**
 * 指定ユーザーの当日 chat_sessions 作成数を数える（db・userId を明示的に受ける下位関数）。
 * テストでは PGlite を差し込むためにこちらを直接呼ぶ。
 *
 * index 8（user_id, created_at DESC）を活かし、user_id 一致かつ created_at >= 今日 0 時で count する。
 */
export async function countTodaySessions(
  db: CatalogDb,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        gte(chatSessions.createdAt, startOfToday(now)),
      ),
    );
  return row?.total ?? 0;
}

/**
 * 現在のログインユーザーがチャットのレート制限に達しているかを判定する公開関数。
 *
 * user_id は認証セッションから強制取得する（主防御。引数で受けない）。
 * 未ログイン（匿名）は制限対象外で常に false を返す（決定 D4/D5）。
 * DB カウントに失敗しても制限側に倒さず false を返し、可用性を優先する（レート制限は
 * コスト保護のベストエフォートであり、DB 障害で正規ユーザーのチャットを止めない）。
 */
export async function isChatRateLimited(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) {
    return false;
  }
  try {
    const todayCount = await countTodaySessions(getDb(), user.id);
    return isRateLimited(todayCount);
  } catch (error) {
    console.error(
      "[api/chat] rate limit count failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
}
