"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/server";
import { getDb } from "@/lib/db/client";
import { isValidSakeId } from "@/lib/db/queries/sakes";
import {
  selectIsFavorite,
  toggleFavoriteRow,
} from "@/lib/db/queries/favorites";

/**
 * お気に入りの追加/削除トグル（Server Action）— T25 / FR-10。
 *
 * 詳細ページのお気に入りボタン（Client Component）から呼ぶ。操作後の状態
 * （true=登録済み）を返し、ボタンが表示を更新する。/favorites 一覧も再検証する。
 *
 * user_id 二段防御（DESIGN §6.2・recordView と同型）:
 * - 主防御: user_id は引数で受けず、必ず認証セッション（getCurrentUser）から取得する。
 *   クライアントから渡せるのは sakeId だけ。他人のお気に入りを操作する経路がない。
 * - 二段目: RLS（favorites。書き込みポリシーなし＝サーバ接続経由のみ）。
 *
 * 戻り値の判別:
 * - 未ログイン: { ok: false, reason: "unauthenticated" }（UI はログインへ誘導）。
 * - 不正 ID: { ok: false, reason: "invalid" }。
 * - 成功: { ok: true, favorited: boolean }。
 */
export type ToggleFavoriteResult =
  | { ok: true; favorited: boolean }
  | { ok: false; reason: "unauthenticated" | "invalid" | "error" };

/**
 * お気に入りボタンの初期状態を取得する（Client Component がマウント時に呼ぶ）。
 *
 * 詳細ページ本体は revalidate=3600 の静的寄り配信のため、ユーザー依存の状態を RSC で
 * 読むと全体が動的化する。それを避け、ボタン側の動的アイランドでのみ状態を読む。
 */
export type FavoriteState = { isLoggedIn: boolean; favorited: boolean };

export async function readFavoriteState(
  sakeId: string,
): Promise<FavoriteState> {
  if (!isValidSakeId(sakeId)) {
    return { isLoggedIn: false, favorited: false };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { isLoggedIn: false, favorited: false };
  }
  try {
    const favorited = await selectIsFavorite(getDb(), user.id, sakeId);
    return { isLoggedIn: true, favorited };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[readFavoriteState] 取得に失敗しました:", message);
    return { isLoggedIn: true, favorited: false };
  }
}

export async function toggleFavorite(
  sakeId: string,
): Promise<ToggleFavoriteResult> {
  if (!isValidSakeId(sakeId)) {
    return { ok: false, reason: "invalid" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, reason: "unauthenticated" };
  }

  try {
    const favorited = await toggleFavoriteRow(getDb(), user.id, sakeId);
    // お気に入り一覧を最新化（詳細ページは楽観的更新のため revalidate 不要）。
    revalidatePath("/favorites");
    return { ok: true, favorited };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[toggleFavorite] お気に入りの更新に失敗しました:", message);
    return { ok: false, reason: "error" };
  }
}
