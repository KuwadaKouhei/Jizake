import { Search } from "lucide-react";
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
 * デザインは Claude Design 1c「藍染めの世界」: 藍の面に縦書き明朝のヒーロー。
 *
 * 推薦は横断ロジック（src/lib/recommend）の固定 IF を通して呼ぶだけで、内部実装
 * （ルールベース）を知らない（差し替え可能な知能。DESIGN §2.5）。
 */

// ホームに並べる推薦件数（機能固有定数。罫線グリッド 4 列に収まりよく 2 段ぶん）。
const HOME_RECOMMEND_LIMIT = 8;

// ユーザー・履歴に依存する動的レンダリング（DESIGN §6.1: 推薦はユーザー依存）。
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  const recommendations = await recommend({
    userId: user?.id ?? null,
    limit: HOME_RECOMMEND_LIMIT,
  });

  // 見出しは「実態」に合わせる（REVIEW T10 PHIL S-2 の透明性）: ログイン済みでも中身が全て
  // フォールバック（reason=popular＝履歴しきい値未満）なら「あなたへのおすすめ」と偽らず
  // 「人気の日本酒」に倒す。履歴ベースの推薦が 1 件でもあればパーソナライズ枠として見せる。
  const hasPersonalized = recommendations.some(
    (item) => item.reason.kind === "history",
  );
  const heading = hasPersonalized ? "あなたへのおすすめ" : "人気の日本酒";

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
      {/* ヒーロー（藍の面・縦書き明朝・「酒」紋・検索導線）。
          デスクトップ（lg+）は 2c: 縦書き見出し群＋大きな酒紋＋右カラム（検索・相談）。 */}
      <section className="mb-8 overflow-hidden rounded-sm bg-primary px-6 py-8 text-primary-foreground sm:px-10 sm:py-10 lg:px-14 lg:py-12">
        <div className="flex items-start justify-between gap-6 lg:items-center lg:gap-10">
          <div className="flex items-start gap-6 lg:gap-9">
            <h1 className="h-[9.5rem] font-heading text-2xl leading-[1.9] font-medium tracking-[0.22em] [writing-mode:vertical-rl] sm:text-[1.7rem] lg:h-[13rem] lg:text-3xl lg:tracking-[0.3em]">
              その土地の水と、
              <br />
              米の記憶。
            </h1>
            <p className="hidden h-[11rem] pt-2 text-xs leading-[2.4] tracking-[0.2em] text-primary-foreground/60 [writing-mode:vertical-rl] lg:block">
              四十七都道府県の蔵から
            </p>
          </div>
          <div
            className="grid size-24 flex-none place-items-center rounded-full border border-primary-foreground/30 sm:size-28 lg:size-44"
            aria-hidden
          >
            <div className="grid size-[4.6rem] place-items-center rounded-full border border-primary-foreground/25 font-heading text-3xl sm:size-20 lg:size-36 lg:text-5xl">
              酒
            </div>
          </div>
          {/* 右カラム（lg のみ）: 検索ボックス＋相談カード（2c） */}
          <div className="hidden w-[22rem] flex-none lg:block">
            <p className="mb-2 text-xs tracking-[0.16em] text-primary-foreground/60">
              — 銘柄・蔵元・県名でさがす
            </p>
            <Link
              href="/search"
              className="flex h-[3.25rem] items-center gap-2 rounded-sm border border-primary-foreground/25 bg-primary-foreground/10 pr-2 pl-4 text-sm text-primary-foreground/60 transition-colors hover:bg-primary-foreground/15"
            >
              <Search className="size-4" aria-hidden />
              <span className="flex-1">例：辛口 燗向き 新潟</span>
              <span className="rounded-sm bg-gold px-4 py-2 text-xs font-bold text-gold-foreground">
                検索
              </span>
            </Link>
            <Link
              href="/chat"
              className="mt-5 flex items-center gap-3.5 border border-primary-foreground/25 p-4 transition-colors hover:bg-primary-foreground/10"
            >
              <span
                className="font-heading text-xs font-semibold tracking-[0.2em] text-gold [writing-mode:vertical-rl]"
                aria-hidden
              >
                相談
              </span>
              <span className="flex-1">
                <span className="block font-heading text-sm font-semibold tracking-wide">
                  杜氏に聞くように、チャットで。
                </span>
                <span className="mt-0.5 block text-[0.7rem] text-primary-foreground/60">
                  好みを話すと、実在の銘柄からご提案
                </span>
              </span>
              <span className="text-gold" aria-hidden>
                →
              </span>
            </Link>
          </div>
        </div>
        <Link
          href="/search"
          className="mt-6 flex h-12 items-center gap-2 rounded-sm border border-primary-foreground/25 bg-primary-foreground/10 px-4 text-sm text-primary-foreground/70 transition-colors hover:bg-primary-foreground/15 lg:hidden"
        >
          <Search className="size-4" aria-hidden />
          銘柄・蔵元・県名でさがす
        </Link>
      </section>

      <section className="mb-10">
        <div className="mb-4 flex items-center gap-3">
          <span className="h-5 w-[3px] flex-none bg-primary" aria-hidden />
          <h2 className="font-heading text-lg font-semibold tracking-wide">
            {heading}
          </h2>
          <Link
            href="/search"
            className="ml-auto border-b border-primary pb-px text-xs text-primary transition-opacity hover:opacity-70"
          >
            すべて見る
          </Link>
        </div>
        {recommendations.length > 0 ? (
          <RecommendGrid items={recommendations} />
        ) : (
          <p className="rounded-sm border border-dashed border-border p-8 text-center text-muted-foreground">
            まだおすすめできる日本酒がありません。
            <Link
              href="/prefectures"
              className="ml-1 underline underline-offset-2 hover:text-primary"
            >
              都道府県から探す
            </Link>
          </p>
        )}
      </section>

      {user ? null : (
        <section className="mb-10 rounded-sm border border-border bg-card p-6 text-center">
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

      {/* チャット相談への誘い（藍枠・縦書き「相談」ラベル。1c のカード）。
          lg+ はヒーロー右カラムに同じ導線があるため出さない。 */}
      <section className="mb-6 lg:hidden">
        <Link
          href="/chat"
          className="flex items-center gap-4 rounded-sm border border-primary bg-card p-4 transition-colors hover:bg-accent"
        >
          <span
            className="font-heading text-sm tracking-[0.2em] text-primary [writing-mode:vertical-rl]"
            aria-hidden
          >
            相談
          </span>
          <span className="flex-1">
            <span className="block font-heading text-sm font-semibold tracking-wide">
              杜氏に聞くように、チャットで。
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              好みを話すと、実在の銘柄からご提案します。
            </span>
          </span>
          <span className="text-primary" aria-hidden>
            →
          </span>
        </Link>
      </section>

      <section className="text-center">
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
