import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

import { getSupabasePublicConfig } from "./env";

/**
 * サーバ用 Supabase クライアント（@supabase/ssr 標準パターン）。
 *
 * RSC・Server Actions・Route Handler から使う。Cookie は Next.js の `cookies()`
 * ストア経由で読み書きする（httpOnly セッション Cookie は @supabase/ssr が扱う）。
 *
 * 注意（DIRECTORY_STRUCTURE §5.2）: `@supabase/*` の import はこの `src/lib/auth`
 * 配下に閉じ、外部にはアプリ内の型（AuthUser 等）だけを漏らす。
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // RSC（Server Component）からの呼び出しでは Cookie 書き込みができず
        // 例外になるが、セッション更新は middleware 側で行うため無視してよい
        // （@supabase/ssr 公式パターン）。Server Action / Route Handler からは
        // 書き込みが有効になる。
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // RSC からの呼び出し。middleware がセッションを更新するため問題ない。
        }
      },
    },
  });
}

/** アプリ内で扱う認証済みユーザー（supabase-js の型をここで閉じる）。 */
export type AuthUser = {
  id: string;
  email: string | null;
};

/**
 * 現在のユーザーを取得する。未ログインなら null。
 *
 * `getUser()` は Supabase Auth サーバへトークンを検証しに行くため、
 * `getSession()`（Cookie を無検証で信じる）より安全（Supabase 公式推奨）。
 * 環境変数未設定など認証基盤が使えない場合も、UI を壊さず未ログイン扱いにする
 * （閲覧・検索は匿名で動く=思想「未ログインでも価値がある」）。
 *
 * React.cache でラップし、同一リクエスト内の複数回呼び出し（ヘッダー・ページ本体・
 * 履歴クエリ等）で getUser() のトークン検証（ネットワーク往復）が反復しないようにする
 * （REVIEW T09 CODE S-1）。
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    // 環境変数未設定（実キー未整備）。認証は使えないが匿名機能は動かす。
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return { id: user.id, email: user.email ?? null };
});
