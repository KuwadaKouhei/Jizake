"use server";

import { redirect } from "next/navigation";

import {
  authUnavailableMessage,
  confirmationSentMessage,
  signInErrorMessage,
  signUpErrorMessage,
} from "./messages";
import { createSupabaseServerClient } from "./server";
import { resolveAfterLogin } from "./redirect";
import { parseCredentials } from "./validation";

/**
 * 認証 Server Actions（signUp / signIn / signOut）。
 *
 * DIRECTORY_STRUCTURE DIR-4: signOut は共通ヘッダ（横断 UI）から呼ばれ、
 * 最初から横断利用が確定しているため、認証アダプタと同居させて src/lib/auth に置く。
 *
 * セキュリティ:
 * - 入力は必ず parseCredentials（Zod）で検証してから Supabase へ渡す。
 * - パスワードのハッシュ化・セッション管理は Supabase Auth に委任（自前実装しない）。
 * - 成功時のリダイレクト先は resolveAfterLogin で自サイト内パスのみ許可
 *   （オープンリダイレクト防止。DESIGN §6.2）。
 * - エラーは握りつぶさず、ユーザー向け文言として返す（CODING_PHILOSOPHY 原則5）。
 */

export type AuthActionState = {
  error: string | null;
  /** 成功系の案内（メール確認待ちなど、リダイレクトせず表示する文言）。 */
  notice?: string | null;
};

/** フォーム送信の共通処理: 入力検証 → Supabase 呼び出し。 */
type SupabaseAuthResult = {
  error: string | null;
  /** サインアップでセッションが張られなかった（メール確認待ち）とき true。 */
  requiresConfirmation?: boolean;
};
type SupabaseAuthOp = (args: {
  email: string;
  password: string;
}) => Promise<SupabaseAuthResult>;

async function runCredentialAction(
  formData: FormData,
  op: SupabaseAuthOp,
): Promise<{
  ok: boolean;
  error: string | null;
  requiresConfirmation: boolean;
}> {
  const parsed = parseCredentials({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error, requiresConfirmation: false };
  }

  const { error, requiresConfirmation } = await op(parsed.data);
  if (error) {
    return { ok: false, error, requiresConfirmation: false };
  }
  return {
    ok: true,
    error: null,
    requiresConfirmation: requiresConfirmation ?? false,
  };
}

/**
 * サインアップ（メール＋パスワード）。
 * セッションが張られた（メール確認 OFF）ときのみ next（既定 /）へ遷移し、
 * メール確認待ち（セッション未発行）のときはリダイレクトせず案内を表示する。
 */
export async function signUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const next = readNext(formData);

  const result = await runCredentialAction(
    formData,
    async ({ email, password }) => {
      let supabase;
      try {
        supabase = await createSupabaseServerClient();
      } catch {
        return { error: authUnavailableMessage() };
      }
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        return { error: signUpErrorMessage(error.message) };
      }
      // Confirm email が ON の設定では session が null（確認メール送信のみ）。
      return { error: null, requiresConfirmation: data.session === null };
    },
  );

  if (!result.ok) {
    return { error: result.error };
  }
  if (result.requiresConfirmation) {
    // 未ログインのままリダイレクトすると /history 等で弾かれ不可解な導線になるため、
    // 遷移せず確認メールの案内を出す（REVIEW T08 CODE S-2）。
    return { error: null, notice: confirmationSentMessage() };
  }
  redirect(resolveAfterLogin(next));
}

/** ログイン（メール＋パスワード）。成功時は next（既定 /）へ遷移。 */
export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const next = readNext(formData);

  const result = await runCredentialAction(
    formData,
    async ({ email, password }) => {
      let supabase;
      try {
        supabase = await createSupabaseServerClient();
      } catch {
        return { error: authUnavailableMessage() };
      }
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error: error ? signInErrorMessage() : null };
    },
  );

  if (!result.ok) {
    return { error: result.error };
  }
  redirect(resolveAfterLogin(next));
}

/** ログアウト。ヘッダから呼ばれる。完了後はホームへ遷移。 */
export async function signOut(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // 認証基盤が未設定でもホームへ戻す（ログアウト操作の失敗を UI に波及させない）。
  }
  redirect("/");
}

/** FormData から next を取り出す（無ければ null）。 */
function readNext(formData: FormData): string | null {
  const raw = formData.get("next");
  return typeof raw === "string" ? raw : null;
}
