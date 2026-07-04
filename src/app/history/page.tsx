import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buildLoginRedirect } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "履歴",
  description: "閲覧・検索の履歴を確認する（要ログイン）。",
};

// 本人のセッションに依存するため動的レンダリング。
export const dynamic = "force-dynamic";

/**
 * 履歴ページ（/history）— 要ログインの保護ルート。
 *
 * 履歴一覧の中身は T09 で実装する。本タスク（T08）では「ログイン必須の枠」だけを
 * 用意する。未ログインは middleware が /login?next=/history へ誘導するが、
 * middleware が働かない環境（環境変数未設定など）でも安全側に倒すため、
 * ページ側でも getCurrentUser で防御する（多層防御。DESIGN §6.2）。
 */
export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect(buildLoginRedirect("/history"));
  }

  return (
    <section className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">履歴</h1>
      <p className="text-muted-foreground">
        閲覧・検索の履歴はここに表示されます。
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        （履歴の記録と一覧表示は今後のアップデートで提供します。）
      </p>
      <p className="mt-6 text-sm">
        <Link
          href="/search"
          className="underline underline-offset-2 hover:text-foreground"
        >
          日本酒を検索する
        </Link>
      </p>
    </section>
  );
}
