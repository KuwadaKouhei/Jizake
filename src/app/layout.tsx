import type { Metadata } from "next";
import { Zen_Kaku_Gothic_New } from "next/font/google";

import { SiteBottomNav } from "@/components/site-bottom-nav";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

// 本文・見出しとも角ゴシック（Claude Design 2a「淡 — 白×藍」は書体を1つに絞る）。
const bodyFont = Zen_Kaku_Gothic_New({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Jizake — 日本酒レコメンド",
    template: "%s | Jizake",
  },
  description:
    "日本酒の検索・都道府県別の地酒探し・好みに合わせたおすすめができる日本酒レコメンドサービス",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${bodyFont.variable} h-full antialiased`}>
      {/* モバイルは下部タブナビ（SiteBottomNav）ぶんの余白を確保する（pb-16）。 */}
      <body className="flex min-h-full flex-col pb-16 md:pb-0">
        <SiteHeader />
        <main className="flex flex-1 flex-col">{children}</main>
        <SiteFooter />
        <SiteBottomNav />
      </body>
    </html>
  );
}
