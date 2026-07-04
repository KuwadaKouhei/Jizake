"use server";

import { redirect } from "next/navigation";

import {
  authUnavailableMessage,
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
};

/** フォーム送信の共通処理: 入力検証 → Supabase 呼び出し。 */
type SupabaseAuthOp = (args: {
  email: string;
  password: string;
}) => Promise<{ error: string | null }>;

async function runCredentialAction(
  formData: FormData,
  op: SupabaseAuthOp,
): Promise<{ ok: boolean; error: string | null }> {
  const parsed = parseCredentials({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error };
  }

  const { error } = await op(parsed.data);
  if (error) {
    return { ok: false, error };
  }
  return { ok: true, error: null };
}

/** サインアップ（メール＋パスワード）。成功時は next（既定 /）へ遷移。 */
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
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error ? signUpErrorMessage(error.message) : null };
    },
  );

  if (!result.ok) {
    return { error: result.error };
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
