import type { ChatStatus } from "ai";
import Link from "next/link";

import type {
  ChatUIMessage,
  FallbackData,
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
      <div className="px-2 py-6 text-center">
        <p className="font-heading text-base tracking-[0.14em] text-primary-foreground">
          どんなお酒を求めていますか？
        </p>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-primary-foreground/70">
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
        <li aria-live="polite" className="text-sm text-primary-foreground/70">
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
  // フォールバック導線（コスト上限超過・LLM 障害時）。サーバが組んだ内部 /search リンクを持つ。
  const fallbackParts = message.parts.filter(
    (
      part,
    ): part is Extract<
      ChatUIMessage["parts"][number],
      { type: "data-fallback" }
    > => part.type === "data-fallback",
  );

  const text = textParts.map((part) => part.text).join("");

  return (
    <div
      className={
        isUser
          ? "ml-auto max-w-[85%] rounded-sm bg-primary-foreground px-3 py-2 text-sm text-primary"
          : "mr-auto max-w-[90%] border-l-2 border-gold pl-3.5 text-primary-foreground"
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

      {fallbackParts.map((part, index) => (
        <FallbackNotice
          key={`fallback-${index}`}
          message={part.data.message}
          searchHref={part.data.searchHref}
        />
      ))}
    </div>
  );
}

/**
 * コスト上限超過・LLM 障害時のフォールバック導線（T15 ①③・DESIGN §6.3/§6.4）。
 *
 * サーバがヒアリング内容から組み立てた検索 URL（必ず内部の /search 始まり）を Link で示し、
 * ユーザーが手ぶらにならないようにする。href が無ければ素の /search へ誘導する。
 */
function FallbackNotice({ message, searchHref }: FallbackData) {
  return (
    <div className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p>{message}</p>
      <Link
        href={searchHref ?? "/search"}
        className="mt-2 inline-block font-medium underline underline-offset-2"
      >
        検索ページで探す
      </Link>
    </div>
  );
}

function ProposedSakes({ sakes }: ProposedSakesData) {
  if (sakes.length === 0) {
    return null;
  }
  return (
    <div className="mt-3">
      <p className="mb-2 font-heading text-sm font-medium tracking-wide text-primary-foreground">
        おすすめの日本酒
      </p>
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
