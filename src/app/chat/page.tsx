import type { Metadata } from "next";

import { ChatContainer } from "./_components/chat-container";

/**
 * RAG チャットページ（TASKS T14 ④・FR-08）。
 *
 * Q&A ヒアリング→DB 実在銘柄の複数提案を行うチャット UI。認証不要（匿名でチャット可。
 * DESIGN §2.3 未ログインでも価値がある）。実際の会話・ストリーミングはクライアントの
 * ChatContainer（useChat）が /api/chat と行う。
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
        <h1 className="text-2xl font-bold tracking-tight">
          日本酒をチャットで相談
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          好みを教えていただければ、登録されている日本酒からおすすめをご提案します。
        </p>
      </div>
      <ChatContainer />
    </main>
  );
}
