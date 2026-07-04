import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/auth/session";

/**
 * middleware — 全リクエストで Supabase セッションを更新し、保護ルート（/history）を
 * ガードする（DESIGN §2.3 / DIRECTORY_STRUCTURE §2）。実処理は @supabase/ssr
 * 標準パターンのヘルパ `updateSession`（src/lib/auth/session.ts）に委譲する。
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /*
   * 以下を除く全パスにマッチさせる（@supabase/ssr 公式の推奨 matcher）:
   * - _next/static（静的ファイル）
   * - _next/image（画像最適化）
   * - favicon.ico
   * - 画像などの静的アセット拡張子
   * セッション更新は認証を伴うページ遷移でのみ必要なため、静的配信は除外する。
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
