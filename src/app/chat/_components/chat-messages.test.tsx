// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ChatUIMessage } from "@/app/api/chat/_lib/tools";
import type { SakeSummary } from "@/lib/db/queries/sakes";

import { ChatMessages } from "./chat-messages";

/**
 * 会話メッセージ表示のユニットテスト（TASKS T14 ⑤）。
 *
 * useChat は使わず、props（メッセージ配列）を直接与えて描画を検証する:
 * - 空状態で「どんなお酒を求めていますか？」を促す。
 * - LLM 応答テキストがプレーンテキストで表示される（HTML は描画しない）。
 * - 提案カード（検証済みデータパート）が銘柄名＋/sake/[id] リンクで描画される。
 */

afterEach(cleanup);

function summary(id: string, name: string): SakeSummary {
  return {
    id,
    name,
    breweryName: "旭酒造",
    prefectureCode: "35",
    tags: [],
  };
}

function userMessage(text: string): ChatUIMessage {
  return {
    id: `u-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistantText(id: string, text: string): ChatUIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}

function assistantWithProposals(
  id: string,
  sakes: SakeSummary[],
): ChatUIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "text", text: "こちらはいかがでしょう。" },
      { type: "data-proposedSakes", data: { sakes } },
    ],
  };
}

function assistantWithFallback(
  id: string,
  message: string,
  searchHref?: string,
): ChatUIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "data-fallback", data: { message, searchHref } }],
  } as unknown as ChatUIMessage;
}

describe("ChatMessages", () => {
  it("空状態では最初のヒアリング問いを促す", () => {
    render(<ChatMessages messages={[]} status="ready" />);
    // getByText は一致要素が無ければ throw する。存在確認になる。
    expect(screen.getByText("どんなお酒を求めていますか？")).toBeTruthy();
  });

  it("LLM 応答テキストをプレーンテキストで表示する（HTML は描画しない）", () => {
    const injected = "<b>強調</b> と <script>alert(1)</script>";
    render(
      <ChatMessages
        messages={[assistantText("a1", injected)]}
        status="ready"
      />,
    );
    // テキストはそのまま（エスケープされて）表示され、<b>/<script> 要素は生成されない。
    expect(screen.getByText(injected)).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });

  it("検証済み提案カードを銘柄名と詳細リンク付きで描画する", () => {
    const sakes = [
      summary("11111111-1111-4111-8111-111111111111", "獺祭"),
      summary("22222222-2222-4222-8222-222222222222", "而今"),
    ];
    render(
      <ChatMessages
        messages={[
          userMessage("辛口が好き"),
          assistantWithProposals("a2", sakes),
        ]}
        status="ready"
      />,
    );

    expect(screen.getByText("獺祭")).toBeTruthy();
    expect(screen.getByText("而今")).toBeTruthy();

    const links = screen
      .getAllByRole("link")
      .map((el) => el.getAttribute("href"));
    expect(links).toContain("/sake/11111111-1111-4111-8111-111111111111");
    expect(links).toContain("/sake/22222222-2222-4222-8222-222222222222");
  });

  it("提案カードが 0 件のデータパートはカード列を描画しない", () => {
    render(
      <ChatMessages
        messages={[assistantWithProposals("a3", [])]}
        status="ready"
      />,
    );
    expect(screen.queryByText("おすすめの日本酒")).toBeNull();
    expect(screen.getByText("こちらはいかがでしょう。")).toBeTruthy();
  });

  it("フォールバック導線（data-fallback）を誘導文言と検索リンクで描画する", () => {
    render(
      <ChatMessages
        messages={[
          assistantWithFallback(
            "f1",
            "会話が長くなりました。検索ページで探してみてください。",
            "/search?tags=%E8%8F%AF%E3%82%84%E3%81%8B",
          ),
        ]}
        status="ready"
      />,
    );
    expect(
      screen.getByText(
        "会話が長くなりました。検索ページで探してみてください。",
      ),
    ).toBeTruthy();
    const link = screen.getByText("検索ページで探す");
    // 内部パス（/search 始まり）であることを確認（オープンリダイレクトなし）。
    expect(link.getAttribute("href")?.startsWith("/search")).toBe(true);
  });

  it("フォールバックに searchHref が無ければ素の /search へ誘導する", () => {
    render(
      <ChatMessages
        messages={[assistantWithFallback("f2", "混み合っています")]}
        status="ready"
      />,
    );
    expect(screen.getByText("検索ページで探す").getAttribute("href")).toBe(
      "/search",
    );
  });

  it("submitted 中はローディング表示を出す", () => {
    render(
      <ChatMessages
        messages={[userMessage("こんにちは")]}
        status="submitted"
      />,
    );
    expect(screen.getByText("考えています…")).toBeTruthy();
  });
});
