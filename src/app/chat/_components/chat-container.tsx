"use client";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatUIMessage } from "@/app/api/chat/_lib/tools";

import { ChatComposer } from "./chat-composer";
import { ChatMessages } from "./chat-messages";

// 最下部から見て「これ以内なら追従スクロールする」しきい値（px）。
// ユーザーが上へ遡って読んでいるときは自動スクロールで邪魔しない。
const STICK_THRESHOLD_PX = 160;

function isNearBottom(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  const scrolledBottom = window.innerHeight + window.scrollY;
  return scrolledBottom >= document.body.scrollHeight - STICK_THRESHOLD_PX;
}

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

  // 新しい発話・生成の進行に合わせて最下部（最新の発話）へスクロールする。
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = endRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior, block: "end" });
    }
  }, []);

  // メッセージが増えた／状態が変わったら最新へスクロール（新着返信で最新に移動）。
  useEffect(() => {
    scrollToBottom("smooth");
  }, [messages.length, status, scrollToBottom]);

  // ストリーミング・タイプライターで本文が伸びる間も最下部に追従する
  // （最下部付近にいるときだけ。ResizeObserver 非対応環境〔テスト等〕では無効）。
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (isNearBottom()) {
        scrollToBottom("auto");
      }
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [scrollToBottom]);

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
      {/* 本文の高さ変化（ストリーミング・タイプライター）を ResizeObserver で追う領域 */}
      <div ref={listRef}>
        <ChatMessages messages={messages} status={status} />
      </div>

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

      {/* スクロール追従の着地点（最新の発話＋入力欄が見える位置へ寄せる） */}
      <div ref={endRef} aria-hidden />
    </div>
  );
}
