import Link from "next/link";

import { signOut } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/server";

// ナビ骨格。実装済み機能のみ導線を出す（TASKS 運用ルール）。
const NAV_ITEMS: readonly { href: string; label: string }[] = [
  { href: "/", label: "ホーム" },
  { href: "/search", label: "検索" },
  { href: "/prefectures", label: "地酒を探す" },
  { href: "/chat", label: "チャットで相談" },
];

/**
 * 全ページ共通ヘッダ。ログイン状態に応じて認証導線を出し分ける（T08 ④）。
 *
 * - 未ログイン: ログイン / 新規登録リンク
 * - ログイン済み: 履歴リンク＋ログアウト（Server Action フォーム）
 *
 * ユーザー取得のため async Server Component。getCurrentUser は認証基盤が
 * 未設定でも null を返す（匿名として描画。閲覧・検索は動く）。
 */
export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Jizake
        </Link>
        <nav aria-label="メインナビゲーション">
          <ul className="flex items-center gap-4 text-sm">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            {user ? (
              <>
                <li>
                  <Link
                    href="/history"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    履歴
                  </Link>
                </li>
                <li>
                  <form action={signOut}>
                    <button
                      type="submit"
                      className="text-muted-foreground transition-colors hover:text-foreground"
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
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    ログイン
                  </Link>
                </li>
                <li>
                  <Link
                    href="/signup"
                    className="text-muted-foreground transition-colors hover:text-foreground"
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
