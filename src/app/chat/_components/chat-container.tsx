"use client";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { useState } from "react";

import type { ChatUIMessage } from "@/app/api/chat/_lib/tools";

import { ChatComposer } from "./chat-composer";
import { ChatMessages } from "./chat-messages";

/**
 * RAG チャットのクライアント本体（TASKS T14 ④・DESIGN §2.6・§4.3）。
 *
 * useChat（AI SDK v6 / @ai-sdk/react）で /api/chat とストリーミングでやり取りする。
 * 会話状態はここ（useChat のメッセージ配列）が保持し、リクエストごとに全履歴を送る
 * ステートレス設計（DESIGN §2.6・決定 D4）。認証不要（匿名でチャット可）。
 *
 * 表示方針（DESIGN §6.2 プロンプトインジェクション対策）:
 * - LLM の応答テキストはプレーンテキスト表示（HTML/リンクをレンダリングしない）。
 * - 提案カードはサーバで DB 存在検証済みのデータパート（data-proposedSakes）からのみ描画する。
 *   LLM の自由文をカードにしないため、ハルシネーション表示は構造的に起きない。
 */
export function ChatContainer() {
  const { messages, sendMessage, status, error } = useChat<ChatUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const [input, setInput] = useState("");

  const isBusy = status === "submitted" || status === "streaming";

  function handleSubmit() {
    const text = input.trim();
    if (text.length === 0 || isBusy) {
      return;
    }
    void sendMessage({ text });
    setInput("");
  }

  return (
    // 淡 — 白×藍（1a）: 白地に藍のユーザー発話・グレーのアシスタント発話のバブル。
    <div className="flex flex-col gap-4">
      <ChatMessages messages={messages} status={status} />

      {/*
        ユーザー向けエラー文言の単一情報源（S-5）。サーバ（route.ts の onError）は
        message のみログに出しストリームにエラーを載せるだけで、文言は画面に出さない。
        useChat は error オブジェクトの有無だけを見て、ここの固定文言を表示する。
        タイムアウト時の検索ページ誘導など詳細フォールバックは T15。
      */}
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          チャットの応答でエラーが発生しました。時間をおいて再度お試しください。
        </p>
      ) : null}

      <ChatComposer
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={isBusy}
      />
    </div>
  );
}
