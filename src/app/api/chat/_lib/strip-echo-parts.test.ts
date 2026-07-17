import { convertToModelMessages } from "ai";
import { describe, expect, it } from "vitest";

import { stripUntrustedAssistantParts } from "./strip-echo-parts";
import type { ChatUIMessage } from "./tools";

/**
 * 過去 assistant の echo パート（data-* / tool-*）を信頼境界外として落とすことの
 * ユニットテスト（レビュー S-4・2 往復目クラッシュの回帰防止）。
 *
 * クライアントはステートレスで全履歴を毎回送るため、過去 assistant の data-* パート
 * （提案カード等）・tool-* パート（ツール呼び出しと検索結果）は「信頼できない echo」。
 * LLM に渡す前に除去し、細工されたパートが LLM コンテキスト（system/tool 材料）に
 * 入らないことを固定する。
 */

const SAKE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "獺祭",
  breweryName: "旭酒造",
  prefectureCode: "35",
  imageUrl: null,
  tags: [],
};

describe("stripUntrustedAssistantParts", () => {
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

    const result = stripUntrustedAssistantParts(messages);

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
      stripUntrustedAssistantParts(messages),
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
    const result = stripUntrustedAssistantParts(messages);
    expect(result[0].parts).toEqual([{ type: "text", text: "こんにちは" }]);
  });

  /**
   * 2 往復目クラッシュの再現（実 LLM キー投入で発覚）。
   *
   * useChat は 2 往復目に、1 往復目の assistant が持つ tool-* パート（searchSake の
   * 呼び出しと検索結果）も履歴として送る。route.ts の Zod スキーマは part を
   * `{ type, text? }` だけで検証し **未知キー（toolCallId/state/input/output）を strip する**
   * ため、tool-* パートは `{ type: "tool-searchSake" }` の抜け殻になる。これを
   * convertToModelMessages に渡すと toolCallId/input を欠いた tool-call が生成され、
   * AI_InvalidPromptError で streamText が落ちる（= 2 往復目が必ず失敗する）。
   */
  it("Zod strip 後の抜け殻 tool-* パートを除去する（2 往復目クラッシュの回帰防止）", () => {
    const messages: ChatUIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "甘くてフルーティなものがいいです" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "text", text: "まずその条件で探してみます。" },
          // Zod が未知キーを strip した後の姿（toolCallId/state/input/output が無い）。
          { type: "tool-searchSake" },
          { type: "text", text: "3037件ほど見つかりました。" },
        ] as unknown as ChatUIMessage["parts"],
      },
    ];

    const result = stripUntrustedAssistantParts(messages);

    // tool-* は落ち、会話テキストは残る（LLM は必要なら再検索すればよい）。
    expect(result[1].parts).toEqual([
      { type: "step-start" },
      { type: "text", text: "まずその条件で探してみます。" },
      { type: "text", text: "3037件ほど見つかりました。" },
    ]);
  });

  it("tool-* を含む履歴でも convertToModelMessages が例外を投げない（本番の 2 往復目と同型）", async () => {
    const messages: ChatUIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "甘くてフルーティなものがいいです" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "まずその条件で探してみます。" },
          { type: "tool-searchSake" },
          { type: "text", text: "3037件ほど見つかりました。" },
        ] as unknown as ChatUIMessage["parts"],
      },
      {
        id: "u2",
        role: "user",
        parts: [
          { type: "text", text: "日本酒初心者でも飲みやすいものが良いです" },
        ],
      },
    ];

    // 修正前はここで AI_InvalidPromptError が投げられていた。
    const modelMessages = await convertToModelMessages(
      stripUntrustedAssistantParts(messages),
    );

    const serialized = JSON.stringify(modelMessages);
    // ツール呼び出しの残骸が LLM 材料に混ざらない。
    expect(serialized).not.toContain("tool-call");
    expect(serialized).not.toContain("searchSake");
    // 会話の文脈（テキスト）は保たれる。
    expect(serialized).toContain("3037件ほど見つかりました。");
    expect(serialized).toContain("日本酒初心者でも飲みやすいものが良いです");
  });
});
