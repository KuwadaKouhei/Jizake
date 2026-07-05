import type { Metadata } from "next";

import { ChatBoundary } from "./_components/chat-boundary";

/**
 * RAG チャットページ（TASKS T14 ④・FR-08）。
 *
 * Q&A ヒアリング→DB 実在銘柄の複数提案を行うチャット UI。認証不要（匿名でチャット可。
 * DESIGN §2.3 未ログインでも価値がある）。実際の会話・ストリーミングはクライアントの
 * ChatContainer（useChat）が /api/chat と行う。
 *
 * 性能（S-6）: LCP 要素（見出し h1・説明文）は RSC のこのページに静的に残し、重い
 * ChatContainer（ai + @ai-sdk/react + zod）は ChatBoundary が `ssr: false` の dynamic
 * import で遅延読み込みする（見出しは即時表示・チャット本体は初期バンドルから分離）。
 */

export const metadata: Metadata = {
  title: "日本酒をチャットで相談 | Jizake",
  description:
    "好みをヒアリングして、アプリに登録された日本酒からおすすめを提案するチャットです。",
};

export default function ChatPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <span className="h-6 w-[3px] flex-none bg-primary" aria-hidden />
          <h1 className="font-heading text-2xl font-bold tracking-wide">
            日本酒をチャットで相談
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          好みを教えていただければ、登録されている日本酒からおすすめをご提案します。
        </p>
      </div>
      <ChatBoundary />
    </main>
  );
}
