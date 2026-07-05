import { convertToModelMessages } from "ai";
import { describe, expect, it } from "vitest";

import { stripAssistantDataParts } from "./strip-data-parts";
import type { ChatUIMessage } from "./tools";

/**
 * 過去 data part を信頼境界外として落とすことのユニットテスト（レビュー S-4）。
 *
 * クライアントはステートレスで全履歴を毎回送るため、過去 assistant の data-* パート
 * （提案カード等）は「信頼できない echo」。LLM に渡す前に除去し、細工された data part が
 * LLM コンテキスト（system/tool 材料）に入らないことを固定する。
 */

const SAKE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "獺祭",
  breweryName: "旭酒造",
  prefectureCode: "35",
  imageUrl: null,
  tags: [],
};

describe("stripAssistantDataParts", () => {
  it("assistant メッセージの data-* パートを除去し text パートは残す", () => {
    const messages: ChatUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "辛口が好き" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "こちらはいかがでしょう。" },
          { type: "data-proposedSakes", data: { sakes: [SAKE] } },
        ],
      },
    ];

    const result = stripAssistantDataParts(messages);

    // data-* は落ち、text は残る。
    expect(result[1].parts).toEqual([
      { type: "text", text: "こちらはいかがでしょう。" },
    ]);
    // user メッセージは無改変。
    expect(result[0]).toEqual(messages[0]);
  });

  it("除去後は convertToModelMessages を通しても data 内容が LLM 材料に混ざらない", async () => {
    const messages: ChatUIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "何かおすすめは？" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "この辺りが人気です。" },
          { type: "data-proposedSakes", data: { sakes: [SAKE] } },
        ],
      },
    ];

    const modelMessages = await convertToModelMessages(
      stripAssistantDataParts(messages),
    );

    // モデルメッセージ全体を文字列化しても、data part 由来の銘柄名・ID が現れない。
    const serialized = JSON.stringify(modelMessages);
    expect(serialized).not.toContain("proposedSakes");
    expect(serialized).not.toContain(SAKE.id);
    // 通常の会話テキストは残る。
    expect(serialized).toContain("この辺りが人気です。");
  });

  it("data-* を持たないメッセージは実質無改変で通す", () => {
    const messages: ChatUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "こんにちは" }] },
    ];
    const result = stripAssistantDataParts(messages);
    expect(result[0].parts).toEqual([{ type: "text", text: "こんにちは" }]);
  });
});
