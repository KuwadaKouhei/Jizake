import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/server";
import { recommend } from "@/lib/recommend";

import { RecommendGrid } from "./_components/recommend-grid";

/**
 * ホーム画面（/）— 履歴ベースおすすめの表示（FR-05 後半）。
 *
 * - ログインユーザー: `recommend({ userId })` が履歴からパーソナライズした銘柄を返す
 *   （履歴が少なければ内部で人気ランキングにフォールバック）。見出しは「あなたへのおすすめ」。
 * - 未ログイン/履歴なし: 人気ランキング（コールドスタート）。見出しは「人気の日本酒」＋
 *   ログイン誘導を併記（思想: 認証を機能のゲートにしない＝未ログインでも価値を出す。
 *   DESIGN §2.3 ゲート方針・PLAN_PHILOSOPHY 原則5）。
 *
 * 推薦は横断ロジック（src/lib/recommend）の固定 IF を通して呼ぶだけで、内部実装
 * （ルールベース）を知らない（差し替え可能な知能。DESIGN §2.5）。
 */

// ホームに並べる推薦件数（機能固有定数。3 列グリッドに収まりよく 2 段ぶん）。
const HOME_RECOMMEND_LIMIT = 6;

// ユーザー・履歴に依存する動的レンダリング（DESIGN §6.1: 推薦はユーザー依存）。
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  const recommendations = await recommend({
    userId: user?.id ?? null,
    limit: HOME_RECOMMEND_LIMIT,
  });

  // ログインしていれば履歴ベース枠として、未ログインなら人気ランキング枠として見出しを出し分ける。
  const heading = user ? "あなたへのおすすめ" : "人気の日本酒";

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <section className="mb-6 text-center sm:mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Jizake</h1>
        <p className="mt-2 text-muted-foreground">
          あなたにぴったりの日本酒が見つかる、日本酒レコメンドサービス。
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-4 text-xl font-semibold tracking-tight">{heading}</h2>
        {recommendations.length > 0 ? (
          <RecommendGrid items={recommendations} />
        ) : (
          <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
            まだおすすめできる日本酒がありません。
            <Link
              href="/prefectures"
              className="ml-1 underline underline-offset-2 hover:text-foreground"
            >
              都道府県から探す
            </Link>
          </p>
        )}
      </section>

      {user ? null : (
        <section className="rounded-lg border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            ログインすると、閲覧・検索の履歴からあなた好みの日本酒をおすすめします。
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href="/login" className={buttonVariants()}>
              ログイン
            </Link>
            <Link
              href="/signup"
              className={buttonVariants({ variant: "outline" })}
            >
              新規登録
            </Link>
          </div>
        </section>
      )}

      <section className="mt-10 text-center">
        <Link
          href="/prefectures"
          className={buttonVariants({ variant: "outline" })}
        >
          都道府県から地酒を探す
        </Link>
      </section>
    </div>
  );
}
