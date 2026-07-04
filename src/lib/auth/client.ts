import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicConfig } from "./env";

/**
 * ブラウザ用 Supabase クライアント（@supabase/ssr 標準パターン）。
 *
 * Client Component から使う（例: 認証状態のリアルタイム購読）。現状の T08 では
 * 認証操作はすべて Server Actions（actions.ts）で行うため未使用だが、以降の
 * クライアント側連携のために標準パターンとして用意する。
 *
 * 呼ぶのはブラウザ実行時のみ（`NEXT_PUBLIC_*` はバンドルへ埋め込まれる公開値）。
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  return createBrowserClient(url, anonKey);
}
