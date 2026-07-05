import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SakeCard } from "@/components/sake-card";
import { buildLoginRedirect } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/server";

import {
  formatViewedAt,
  searchHistoryToHref,
  searchHistoryToLabels,
} from "./_lib/format";
import { getSearchHistoryPage, getViewHistoryPage } from "./_lib/queries";

export const metadata: Metadata = {
  title: "履歴",
  description: "閲覧・検索の履歴を確認する（要ログイン）。",
};

// 本人のセッション・履歴に依存するため動的レンダリング。
export const dynamic = "force-dynamic";

/**
 * 履歴ページ（/history）— 要ログインの保護ルート（FR-05 前半 / FR-04）。
 *
 * ログインユーザーの閲覧履歴（SakeCard で詳細へ）と検索履歴（条件を再検索する
 * /search?... リンク）を新しい順に表示する。履歴取得クエリは user_id を認証セッションから
 * 強制取得する（主防御。DESIGN §6.2）。
 *
 * 未ログインは middleware（proxy）が /login?next=/history へ誘導するが、middleware が
 * 働かない環境でも安全側に倒すため、ページ側でも getCurrentUser で防御する（多層防御）。
 */
export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect(buildLoginRedirect("/history"));
  }

  // user_id は各クエリが認証セッションから強制取得する（ここでは page を渡さず 1 ページ目）。
  // 現状は直近 24 件のみ表示（ページャ UI は将来対応。REVIEW T09 PERF C-1）。行数が増えたら
  // OFFSET から keyset ページネーションへ移行する。
  const [viewHistory, searchHistory] = await Promise.all([
    getViewHistoryPage(),
    getSearchHistoryPage(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="mb-8 text-2xl font-bold tracking-tight sm:text-3xl">
        履歴
      </h1>

      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold">閲覧した日本酒</h2>
        {viewHistory.entries.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {viewHistory.entries.map((entry, index) => (
              <li key={entry.id} className="grid gap-1">
                <SakeCard sake={entry.sake} index={index} />
                <p className="px-1 text-xs text-muted-foreground">
                  {formatViewedAt(entry.viewedAt)} 閲覧
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
            まだ閲覧した日本酒はありません。
            <Link
              href="/search"
              className="ml-1 underline underline-offset-2 hover:text-foreground"
            >
              日本酒を探す
            </Link>
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">検索した条件</h2>
        {searchHistory.entries.length > 0 ? (
          <ul className="grid gap-2">
            {searchHistory.entries.map((entry) => {
              const labels = searchHistoryToLabels(entry);
              return (
                <li key={entry.id}>
                  <Link
                    href={searchHistoryToHref(entry)}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm transition-colors hover:bg-muted/50"
                  >
                    <span className="text-xs text-muted-foreground">
                      {formatViewedAt(entry.searchedAt)}
                    </span>
                    {labels.map((label, i) => (
                      <span
                        key={`${i}-${label}`}
                        className="rounded-full bg-muted px-2 py-0.5 text-xs"
                      >
                        {label}
                      </span>
                    ))}
                    <span className="ml-auto text-xs underline underline-offset-2">
                      この条件で再検索
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
            まだ検索履歴はありません。
            <Link
              href="/search"
              className="ml-1 underline underline-offset-2 hover:text-foreground"
            >
              日本酒を検索する
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
