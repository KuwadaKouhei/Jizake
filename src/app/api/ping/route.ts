import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { getDb } from "@/lib/db/client";

/**
 * Supabase 無操作停止対策の keep-alive ping（Vercel Cron から叩く）。
 *
 * 無料枠の Supabase は約 7 日間アクティビティが無いと一時停止する。Vercel Cron
 * （vercel.json の crons）が定期的にこのエンドポイントを叩き、DB へ軽量クエリを
 * 1 回投げて「活動あり」の状態を保つ。GitHub Actions 版の ping
 * （.github/workflows/ping-supabase.yml）と二重化した対策（そちらは Secrets 登録が前提で、
 * リポジトリ無更新が続くと GitHub にスケジュールを無効化される弱点があるため、
 * デプロイと一体で動く本 Cron を主とする）。
 *
 * セキュリティ: `CRON_SECRET` 環境変数を設定している場合のみ、Vercel Cron が送る
 * `Authorization: Bearer <CRON_SECRET>` を検証する（未設定なら公開の軽量 ping として動く。
 * 実行内容は `select 1` のみで副作用・情報漏洩は無い）。
 */

// リクエスト時に必ず DB へ触れる（静的化・キャッシュを無効化）。
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  try {
    // 最小コストのクエリ 1 回で「DB 接続＋クエリ」の活動を発生させる。
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // 失敗しても内部詳細は返さずログのみ（DESIGN §6.2）。Cron 側にはエラー扱いさせる。
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      "[api/ping] Supabase keep-alive ping に失敗しました:",
      message,
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
