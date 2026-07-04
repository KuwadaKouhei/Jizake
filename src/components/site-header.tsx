import Link from "next/link";

// ナビ骨格。機能の実装タスク（T06 検索・T08 認証等）で項目を追加する。
// 未実装機能への導線は出さない（TASKS 運用ルール）。
const NAV_ITEMS: readonly { href: string; label: string }[] = [
  { href: "/", label: "ホーム" },
];

export function SiteHeader() {
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
          </ul>
        </nav>
      </div>
    </header>
  );
}
