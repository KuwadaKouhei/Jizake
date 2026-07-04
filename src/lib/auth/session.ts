import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "./env";
import { buildLoginRedirect, isProtectedPath } from "./redirect";

/**
 * middleware 用のセッション更新（@supabase/ssr 標準パターン）。
 *
 * - 毎リクエストでトークンをリフレッシュし、更新後の Cookie をレスポンスへ書き戻す。
 * - `getUser()` で実ユーザーを検証し、保護ルート（/history）へ未ログインで
 *   アクセスした場合は `/login?next=...` へリダイレクトする（DESIGN §2.3）。
 *
 * 環境変数未設定（実キー未整備=T02 残作業）でも middleware 全体を落とさない:
 * その場合はセッション更新を skip し、保護ルートへのアクセスのみ /login へ誘導する
 * （匿名で使える閲覧・検索は素通しさせる。思想「未ログインでも価値がある」）。
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  let config;
  try {
    config = getSupabasePublicConfig();
  } catch {
    // 認証基盤が未設定。保護ルートは（ユーザーを確認できないため）ログインへ誘導する。
    if (isProtectedPath(request.nextUrl.pathname)) {
      return redirectToLogin(request);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // 重要: createServerClient と getUser の間にコードを挟まない（公式の注意事項。
  // セッションのランダムなログアウトを防ぐため）。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtectedPath(request.nextUrl.pathname)) {
    return redirectToLogin(request);
  }

  return supabaseResponse;
}

/** 現在のパスを next に保持して /login へリダイレクトするレスポンスを作る。 */
function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  const destination = buildLoginRedirect(request.nextUrl.pathname);
  const [pathname, search] = destination.split("?");
  url.pathname = pathname;
  url.search = search ? `?${search}` : "";
  return NextResponse.redirect(url);
}
