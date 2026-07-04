import type { ChatStatus } from "ai";

import type {
  ChatUIMessage,
  ProposedSakesData,
} from "@/app/api/chat/_lib/tools";
import { SakeCard } from "@/components/sake-card";

/**
 * 会話メッセージ列の表示（TASKS T14 ④）。
 *
 * - 空状態: 最初のヒアリング問い（「どんなお酒を求めていますか？」）を促す。
 * - LLM 応答テキスト: text パートを**プレーンテキスト**で描画する
 *   （dangerouslySetInnerHTML は使わない。DESIGN §6.2 XSS 防止）。React は
 *   既定で子テキストをエスケープする。
 * - 提案カード: サーバで DB 存在検証済みの data-proposedSakes パートからのみ
 *   SakeCard（/sake/[id] リンク付き・共用）で描画する。
 */
export function ChatMessages({
  messages,
  status,
}: {
  messages: ChatUIMessage[];
  status: ChatStatus;
}) {
  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-base font-medium">どんなお酒を求めていますか？</p>
        <p className="mt-1 text-sm text-muted-foreground">
          味わいの好み・予算・産地・飲むシーンなどを教えてください。数問のやり取りで
          おすすめの日本酒をご提案します。
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {messages.map((message) => (
        <li key={message.id}>
          <ChatMessageItem message={message} />
        </li>
      ))}
      {status === "submitted" ? (
        <li aria-live="polite" className="text-sm text-muted-foreground">
          考えています…
        </li>
      ) : null}
    </ul>
  );
}

function ChatMessageItem({ message }: { message: ChatUIMessage }) {
  const isUser = message.role === "user";

  // テキスト（プレーン表示）と提案カード（検証済み）を parts から取り出す。
  // 注（S-4 併記）: data part は「サーバが送った検証済み」のもののみが届く。クライアントが
  // 過去履歴で偽装した data-* は Zod 検証で未知キーとして strip され、サーバの
  // stripAssistantDataParts でも落ちるため LLM にも描画にも到達しない（偽装カード不可能）。
  const textParts = message.parts.filter(
    (part): part is Extract<ChatUIMessage["parts"][number], { type: "text" }> =>
      part.type === "text",
  );
  const proposedParts = message.parts.filter(
    (
      part,
    ): part is Extract<
      ChatUIMessage["parts"][number],
      { type: "data-proposedSakes" }
    > => part.type === "data-proposedSakes",
  );

  const text = textParts.map((part) => part.text).join("");

  return (
    <div
      className={
        isUser
          ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
          : "mr-auto max-w-full"
      }
    >
      {text.length > 0 ? (
        <p className="whitespace-pre-wrap text-sm">{text}</p>
      ) : null}

      {proposedParts.map((part, index) => (
        // 安定キー（C-2）: 提案の先頭銘柄 ID を使う。data part には固有 id が無いため、
        // 空提案（先頭なし）のみ index にフォールバックする。
        <ProposedSakes
          key={part.data.sakes[0]?.id ?? `proposed-${index}`}
          sakes={part.data.sakes}
        />
      ))}
    </div>
  );
}

function ProposedSakes({ sakes }: ProposedSakesData) {
  if (sakes.length === 0) {
    return null;
  }
  return (
    <div className="mt-3">
      <p className="mb-2 text-sm font-medium">おすすめの日本酒</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sakes.map((sake) => (
          <li key={sake.id}>
            <SakeCard sake={sake} />
          </li>
        ))}
      </ul>
    </div>
  );
}
