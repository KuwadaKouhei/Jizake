"use server";

import { getCurrentUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { isValidSakeId } from "@/lib/db/queries/sakes";
import { viewHistories } from "@/lib/db/schema";

/**
 * 閲覧履歴の記録（Server Action）— FR-05 前半 / DESIGN §2.4。
 *
 * 詳細ページに置いた小さな Client Component（record-view-trigger）がマウント時に
 * fire-and-forget で呼ぶ。RSC レンダリング中に INSERT しない理由は、プリフェッチ・
 * キャッシュ・ボットで多重記録されるため（DESIGN §2.4 / 決定 D3）。Client Component の
 * useEffect は実ブラウザ表示時にのみ動くため、実閲覧だけを記録できる。
 *
 * user_id 二段防御（DESIGN §6.2）:
 * - 主防御: user_id は引数で受けず、必ず認証セッション（getCurrentUser）から取得する。
 *   クライアントから渡せるのは sakeId だけで、他人の user_id で記録する経路がない。
 * - 二段目: RLS（書き込みポリシーなし＝anon 経由の INSERT は全拒否。DATABASE §4.2 / DB-9）。
 *
 * 未ログインは no-op（DESIGN §5.3: recordView は未ログインで no-op）。
 * 記録の失敗はページ表示に影響させない（fire-and-forget）ため、ここで捕捉してログのみ残し、
 * 例外を呼び出し側（Client）へ伝播させない。握りつぶし禁止規約に反しないよう、
 * 「表示を壊さないための意図的な吸収」であることを明示し、必ずログに出す。
 */
export async function recordView(sakeId: string): Promise<void> {
  // クライアントからの入力は信用しない（DESIGN §5.2）。UUID 書式でなければ何もしない。
  if (!isValidSakeId(sakeId)) {
    return;
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      // 未ログインは記録しない（no-op）。
      return;
    }

    await getDb().insert(viewHistories).values({
      userId: user.id,
      sakeId,
    });
  } catch (error) {
    // fire-and-forget の記録失敗は表示に影響させない（DESIGN §4.1）。
    // 握りつぶさずログに残すが、SQL パラメータ等をログに含めないよう message のみに絞る
    // （ログ経由の情報漏洩防止。REVIEW T09 SEC S-3）。
    const message = error instanceof Error ? error.message : String(error);
    console.error("[recordView] 閲覧履歴の記録に失敗しました:", message);
  }
}
