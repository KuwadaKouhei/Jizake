/**
 * Supabase の公開接続情報（URL・anon キー）の取得。
 *
 * - `NEXT_PUBLIC_*` はビルド時にクライアントバンドルへ埋め込まれる公開値
 *   （anon キーは RLS 前提の公開可能キー。DESIGN §6.2）。シークレットではない。
 * - クライアント生成の各ヘルパから呼ぶ**遅延取得**にすることで、環境変数が
 *   未設定のビルド環境でも import・ビルドが壊れない（実キー未整備の現状=T02 残作業）。
 *   未設定のままランタイムで認証機能を使うと、ここで明確なエラーになる
 *   （握りつぶさない。CODING_PHILOSOPHY 原則5）。
 */

export type SupabasePublicConfig = {
  url: string;
  anonKey: string;
};

/**
 * 環境変数から Supabase の公開接続情報を読む。未設定なら明確なエラーを投げる。
 *
 * @throws 環境変数が未設定・空のとき
 */
export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Supabase の環境変数が未設定です: ${missing.join(
        ", ",
      )}（.env.example 参照。Supabase 実プロジェクト作成後に .env.local へ設定する）`,
    );
  }

  return { url: url as string, anonKey: anonKey as string };
}
