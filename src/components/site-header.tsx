import Link from "next/link";

import { signOut } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/server";

// ナビ骨格。実装済み機能のみ導線を出す（TASKS 運用ルール）。
const NAV_ITEMS: readonly { href: string; label: string }[] = [
  { href: "/", label: "ホーム" },
  { href: "/search", label: "さがす" },
  { href: "/prefectures", label: "四十七県" },
  { href: "/chat", label: "相談の間" },
];

/**
 * 全ページ共通ヘッダ。ログイン状態に応じて認証導線を出し分ける（T08 ④）。
 *
 * - 未ログイン: ログイン / 新規登録リンク
 * - ログイン済み: 履歴リンク＋ログアウト（Server Action フォーム）
 *
 * デザインは Claude Design 1c「藍染めの世界」。ブランドは明朝＋藍。
 * 主要ナビはデスクトップで表示し、モバイルは下部タブ（SiteBottomNav）に委ねる。
 *
 * ユーザー取得のため async Server Component。getCurrentUser は認証基盤が
 * 未設定でも null を返す（匿名として描画。閲覧・検索は動く）。
 */
export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="font-heading text-xl font-bold tracking-[0.16em] text-primary"
        >
          Jizake
        </Link>
        <nav aria-label="メインナビゲーション">
          <ul className="flex items-center gap-3 text-sm sm:gap-5">
            {NAV_ITEMS.map((item) => (
              <li key={item.href} className="hidden md:block">
                <Link
                  href={item.href}
                  className="text-muted-foreground transition-colors hover:text-primary"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            {user ? (
              <>
                <li className="hidden md:block">
                  <Link
                    href="/history"
                    className="text-muted-foreground transition-colors hover:text-primary"
                  >
                    履歴
                  </Link>
                </li>
                <li>
                  <form action={signOut}>
                    <button
                      type="submit"
                      className="text-muted-foreground transition-colors hover:text-primary"
                    >
                      ログアウト
                    </button>
                  </form>
                </li>
              </>
            ) : (
              <>
                <li>
                  <Link
                    href="/login"
                    className="rounded-sm border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    ログイン
                  </Link>
                </li>
                <li className="hidden sm:block">
                  <Link
                    href="/signup"
                    className="text-muted-foreground transition-colors hover:text-primary"
                  >
                    新規登録
                  </Link>
                </li>
              </>
            )}
          </ul>
        </nav>
      </div>
    </header>
  );
}
