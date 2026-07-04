import { describe, expect, it } from "vitest";

import {
  countUserTurns,
  exceedsConversationLimit,
  MAX_CONVERSATION_TURNS,
} from "./conversation-guard";
import type { ChatUIMessage } from "./tools";

/**
 * コスト上限ガードの往復数判定（TASKS T15 ①・DESIGN §6.3）のユニットテスト。
 * ステートレスで毎回全履歴が来る前提で、user 発話数＝往復数で上限を判定することを固定する。
 */

function userMsg(text: string): ChatUIMessage {
  return {
    id: `u-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  } as ChatUIMessage;
}

function assistantMsg(text: string): ChatUIMessage {
  return {
    id: `a-${text}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  } as ChatUIMessage;
}

/** user n 件・assistant n 件を交互に並べた履歴を作る（往復 n 回）。 */
function conversation(turns: number): ChatUIMessage[] {
  const messages: ChatUIMessage[] = [];
  for (let i = 0; i < turns; i++) {
    messages.push(userMsg(`q${i}`));
    messages.push(assistantMsg(`a${i}`));
  }
  return messages;
}

describe("countUserTurns", () => {
  it("user ロールのメッセージ数を数える（assistant は数えない）", () => {
    expect(countUserTurns(conversation(3))).toBe(3);
  });

  it("空配列は 0", () => {
    expect(countUserTurns([])).toBe(0);
  });

  it("assistant のみは 0", () => {
    expect(countUserTurns([assistantMsg("a")])).toBe(0);
  });
});

describe("exceedsConversationLimit", () => {
  it("ちょうど上限回の往復までは超過扱いにしない", () => {
    expect(exceedsConversationLimit(conversation(MAX_CONVERSATION_TURNS))).toBe(
      false,
    );
  });

  it("上限を 1 回超えると超過扱い（LLM を呼ばず検索誘導へ倒す）", () => {
    expect(
      exceedsConversationLimit(conversation(MAX_CONVERSATION_TURNS + 1)),
    ).toBe(true);
  });

  it("短い会話は超過しない", () => {
    expect(exceedsConversationLimit(conversation(1))).toBe(false);
  });
});
