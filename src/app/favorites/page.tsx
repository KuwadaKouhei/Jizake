import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SakeCard } from "@/components/sake-card";
import { buildLoginRedirect } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/server";
import { getFavoriteSakes } from "@/lib/db/queries/favorites";

export const metadata: Metadata = {
  title: "お気に入り",
  description: "お気に入りに登録した日本酒の一覧（要ログイン）。",
};

// 本人のセッション・お気に入りに依存するため動的レンダリング。
export const dynamic = "force-dynamic";

/**
 * お気に入り一覧ページ（/favorites）— 要ログインの保護ルート（FR-10 / FR-04）。
 *
 * ログインユーザーがお気に入り登録した銘柄を新しい順に SakeCard で表示する。
 * user_id は認証セッションから強制取得する（主防御。DESIGN §6.2）。
 *
 * 未ログインは proxy（middleware）が /login?next=/favorites へ誘導するが、
 * middleware が働かない環境でも安全側に倒すため、ページ側でも防御する（多層防御）。
 */
export default async function FavoritesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect(buildLoginRedirect("/favorites"));
  }

  const sakes = await getFavoriteSakes(user.id);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
        お気に入り
      </h1>
      <p className="mb-8 text-sm text-muted-foreground">
        {sakes.length > 0
          ? `${sakes.length}件の日本酒をお気に入りに登録しています。`
          : "お気に入りはまだありません。"}
      </p>

      {sakes.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {sakes.map((sake, index) => (
            <li key={sake.id}>
              <SakeCard sake={sake} index={index} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          気になる日本酒の詳細ページで「お気に入りに追加」すると、ここに集まります。
          <Link
            href="/search"
            className="mt-2 inline-block underline underline-offset-2 hover:text-primary"
          >
            日本酒を探す
          </Link>
        </p>
      )}
    </div>
  );
}
