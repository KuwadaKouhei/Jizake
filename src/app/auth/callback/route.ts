import { NextResponse, type NextRequest } from "next/server";

import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/auth/server";

/**
 * OAuth（Google 等）コールバック Route Handler（T24）。
 *
 * プロバイダ認可後に `?code=...&next=...` で戻ってくる。code をセッションに交換し
 * （exchangeCodeForSession が httpOnly Cookie を書き戻す）、アプリ内の安全な next
 * （既定 /）へリダイレクトする。失敗時は /login?error=oauth へ戻す。
 *
 * セキュリティ:
 * - next はアプリ内パスのみ許可（sanitizeRedirectPath）＝オープンリダイレクト防止。
 * - エラー詳細（プロバイダ拒否・code 交換失敗）は出さず、汎用の error=oauth に倒す。
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = sanitizeRedirectPath(searchParams.get("next")) ?? "/";

  if (!code) {
    // provider がエラー（access_denied 等）を返した、または直アクセス。
    return NextResponse.redirect(new URL("/login?error=oauth", origin));
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=oauth", origin));
    }
  } catch {
    // 認証基盤が未設定など。ログインへ戻す。
    return NextResponse.redirect(new URL("/login?error=oauth", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
