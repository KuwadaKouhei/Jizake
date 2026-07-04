// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatUIMessage } from "@/app/api/chat/_lib/tools";

/**
 * チャットクライアント本体のユニットテスト（TASKS T14 ⑤）。
 *
 * useChat（@ai-sdk/react）をモックし、実 API を叩かずに:
 * - 空状態（メッセージ 0 件）でヒアリング問いが出る、
 * - 入力して送信すると sendMessage が入力テキストで呼ばれ、入力がクリアされる、
 * - 送信中は送信が無効、
 * - error があるとエラー文言が出る、
 * を検証する。
 */

const { useChat } = vi.hoisted(() => ({ useChat: vi.fn() }));
vi.mock("@ai-sdk/react", () => ({ useChat }));

import { ChatContainer } from "./chat-container";

type ChatState = {
  messages: ChatUIMessage[];
  sendMessage: ReturnType<typeof vi.fn>;
  status: string;
  error: Error | undefined;
};

function mockUseChat(overrides: Partial<ChatState> = {}) {
  const sendMessage = overrides.sendMessage ?? vi.fn();
  useChat.mockReturnValue({
    messages: overrides.messages ?? [],
    sendMessage,
    status: overrides.status ?? "ready",
    error: overrides.error,
  });
  return { sendMessage };
}

afterEach(cleanup);
beforeEach(() => {
  useChat.mockReset();
});

describe("ChatContainer", () => {
  it("空状態でヒアリング問いを表示する", () => {
    mockUseChat();
    render(<ChatContainer />);
    expect(screen.getByText("どんなお酒を求めていますか？")).toBeTruthy();
  });

  it("入力して送信すると sendMessage が入力テキストで呼ばれ入力がクリアされる", () => {
    const { sendMessage } = mockUseChat();
    render(<ChatContainer />);

    const textarea =
      screen.getByLabelText<HTMLTextAreaElement>("メッセージを入力");
    fireEvent.change(textarea, { target: { value: "辛口が好き" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    expect(sendMessage).toHaveBeenCalledWith({ text: "辛口が好き" });
    expect(textarea.value).toBe("");
  });

  it("空入力では送信できない（sendMessage を呼ばない）", () => {
    const { sendMessage } = mockUseChat();
    render(<ChatContainer />);

    // 入力が空なので送信ボタンは無効。フォーム送信しても sendMessage は呼ばれない。
    fireEvent.submit(
      screen.getByLabelText("メッセージを入力").closest("form")!,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("送信中（streaming）は sendMessage を呼ばない", () => {
    const { sendMessage } = mockUseChat({ status: "streaming" });
    render(<ChatContainer />);

    const textarea = screen.getByLabelText("メッセージを入力");
    fireEvent.change(textarea, { target: { value: "追撃メッセージ" } });
    fireEvent.submit(textarea.closest("form")!);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("error があるとエラー文言を表示する", () => {
    mockUseChat({ error: new Error("boom") });
    render(<ChatContainer />);
    expect(screen.getByRole("alert").textContent).toContain(
      "チャットの応答でエラーが発生しました",
    );
  });
});
