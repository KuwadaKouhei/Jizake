"use client";

import { House, MapIcon, MessageCircle, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/cn";

/**
 * モバイル用の下部タブナビ（Claude Design 1c「藍染めの世界」）。
 *
 * md 未満でのみ表示する（デスクトップは SiteHeader のナビを使う）。
 * 現在ルートを usePathname で判定して藍色でハイライトする。
 * 実装済み機能のみ導線に出す（TASKS 運用ルール・SiteHeader と揃える）。
 */
const NAV_ITEMS: readonly {
  href: string;
  label: string;
  icon: typeof House;
}[] = [
  { href: "/", label: "ホーム", icon: House },
  { href: "/search", label: "検索", icon: Search },
  { href: "/prefectures", label: "四十七県", icon: MapIcon },
  { href: "/chat", label: "相談", icon: MessageCircle },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="モバイルナビゲーション"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[0.68rem] transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
                <span className={active ? "font-bold" : undefined}>
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
