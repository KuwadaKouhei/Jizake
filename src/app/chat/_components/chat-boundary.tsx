"use client";

import dynamic from "next/dynamic";

/**
 * チャット本体の遅延読み込み境界（レビュー S-6・性能）。
 *
 * ChatContainer は ai + @ai-sdk/react + zod を引き込み /chat のバンドルが大きい。
 * ここで `next/dynamic` の `ssr: false` で初期バンドルから切り離し、LCP 要素
 * （見出し h1・説明文）は page.tsx（RSC）側に静的に残す。RSC では
 * `dynamic(..., { ssr: false })` が使えないため、この小さな Client 境界を挟む。
 *
 * 読み込み中は軽量スケルトンを表示して体感を保つ。
 */
const ChatContainer = dynamic(
  () => import("./chat-container").then((mod) => mod.ChatContainer),
  {
    ssr: false,
    loading: () => (
      <div
        className="animate-pulse rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
        aria-hidden
      >
        チャットを読み込んでいます…
      </div>
    ),
  },
);

export function ChatBoundary() {
  return <ChatContainer />;
}
