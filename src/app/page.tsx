import { MessageCircle, Search } from "lucide-react";
import Link from "next/link";

import { tagChipClassName } from "@/components/tag-chip";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
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
 * デザインは Claude Design 2a「淡 — 白×藍」: 検索を主役にしたクリーンなポータル。
 * 中央寄せのヒーロー（見出し＋検索ピル＋味わいチップ）→ 人気カードグリッド →
 * チャット相談 CTA の縦積み。
 *
 * 推薦は横断ロジック（src/lib/recommend）の固定 IF を通して呼ぶだけで、内部実装
 * （ルールベース）を知らない（差し替え可能な知能。DESIGN §2.5）。
 */

// ホームに並べる推薦件数（機能固有定数。カードグリッド 4 列に収まりよく 2 段ぶん）。
const HOME_RECOMMEND_LIMIT = 8;

// ヒーロー下のクイック検索チップ（代表的な味わいタグ。/search?tags=… に直結）。
const QUICK_TAG_NAMES = ["辛口", "甘口", "淡麗", "濃醇"] as const;

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
      {/* ヒーロー（2a: 中央寄せの見出し＋検索ピル＋味わいチップ） */}
      <section className="mb-10 pt-6 text-center sm:pt-12 sm:pb-4">
        <h1 className="text-3xl leading-snug font-bold tracking-tight sm:text-4xl">
          今夜の一杯を、さがそう。
        </h1>
        <p className="mt-3 text-sm text-muted-foreground sm:text-[0.95rem]">
          全国の地酒から、あなたの好みに合う一本を。
        </p>
        <Link
          href="/search"
          className="mx-auto mt-7 flex h-12 max-w-xl items-center gap-3 rounded-full border-[1.5px] border-input bg-background pr-2 pl-5 text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/50 sm:h-14 sm:text-[0.95rem]"
        >
          <Search className="size-4 text-primary" aria-hidden />
          <span className="flex-1 text-left">銘柄名・県名・味わいで検索</span>
          <span className="hidden rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground sm:inline-block">
            検索
          </span>
        </Link>
        <ul className="mt-4 flex flex-wrap justify-center gap-2">
          {QUICK_TAG_NAMES.map((name) => (
            <li key={name}>
              <Link
                href={`/search?tags=${encodeURIComponent(name)}`}
                className={cn(
                  "inline-block rounded-full px-3.5 py-1.5 text-xs transition-opacity hover:opacity-75",
                  tagChipClassName({ name, category: "taste" }),
                )}
              >
                {name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xl font-bold tracking-tight">{heading}</h2>
          <Link
            href="/search"
            className="text-sm text-primary transition-opacity hover:opacity-75"
          >
            すべて見る →
          </Link>
        </div>
        {recommendations.length > 0 ? (
          <RecommendGrid items={recommendations} />
        ) : (
          <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
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

      {/* チャット相談への誘い（2a: 藍の丸アイコン＋ピル CTA のカード） */}
      <section className="mb-10">
        <Link
          href="/chat"
          className="flex items-center gap-4 rounded-2xl border border-border bg-muted/50 p-4 transition-colors hover:bg-muted sm:p-6"
        >
          <span
            className="grid size-11 flex-none place-items-center rounded-full bg-primary text-primary-foreground sm:size-13"
            aria-hidden
          >
            <MessageCircle className="size-5 sm:size-6" />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-bold sm:text-base">
              チャットで相談する
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground sm:text-sm">
              「甘めで冷やして美味しいの」——好みを話すだけで、ぴったりの一本をご提案。
            </span>
          </span>
          <span
            className="hidden rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground sm:inline-block"
            aria-hidden
          >
            相談をはじめる
          </span>
          <span className="text-primary sm:hidden" aria-hidden>
            →
          </span>
        </Link>
      </section>

      {user ? null : (
        <section className="mb-10 rounded-2xl border border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            ログインすると、閲覧・検索の履歴からあなた好みの日本酒をおすすめします。
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link
              href="/login"
              className={cn(buttonVariants(), "rounded-full px-5")}
            >
              ログイン
            </Link>
            <Link
              href="/signup"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "rounded-full px-5",
              )}
            >
              新規登録
            </Link>
          </div>
        </section>
      )}

      <section className="text-center">
        <Link
          href="/prefectures"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "rounded-full px-5",
          )}
        >
          都道府県から地酒を探す
        </Link>
      </section>
    </div>
  );
}
