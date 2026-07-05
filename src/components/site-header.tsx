import Link from "next/link";

import { signOut } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/server";

// ナビ骨格。実装済み機能のみ導線を出す（TASKS 運用ルール）。
const NAV_ITEMS: readonly { href: string; label: string }[] = [
  { href: "/", label: "ホーム" },
  { href: "/search", label: "さがす" },
  { href: "/prefectures", label: "地酒マップ" },
  { href: "/chat", label: "チャット相談" },
];

/**
 * 全ページ共通ヘッダ。ログイン状態に応じて認証導線を出し分ける（T08 ④）。
 *
 * - 未ログイン: ログイン（テキスト）＋「はじめる」ピル（新規登録 CTA）
 * - ログイン済み: 履歴リンク＋ログアウト（Server Action フォーム）
 *
 * デザインは Claude Design 2a「淡 — 白×藍」。白地に藍のブランド・ピル形 CTA。
 * 主要ナビはデスクトップで表示し、モバイルは下部タブ（SiteBottomNav）に委ねる。
 *
 * ユーザー取得のため async Server Component。getCurrentUser は認証基盤が
 * 未設定でも null を返す（匿名として描画。閲覧・検索は動く）。
 */
export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link
          href="/"
          className="text-lg font-bold tracking-tight text-primary"
        >
          Jizake
        </Link>
        <nav aria-label="メインナビゲーション">
          <ul className="flex items-center gap-3 text-sm sm:gap-6">
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
                    href="/favorites"
                    className="text-muted-foreground transition-colors hover:text-primary"
                  >
                    お気に入り
                  </Link>
                </li>
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
                    className="text-muted-foreground transition-colors hover:text-primary"
                  >
                    ログイン
                  </Link>
                </li>
                <li>
                  <Link
                    href="/signup"
                    className="inline-block rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-85"
                  >
                    はじめる
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
