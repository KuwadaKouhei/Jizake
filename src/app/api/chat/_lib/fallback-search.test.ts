import { describe, expect, it } from "vitest";

import {
  buildFallbackSearchHref,
  collectUserText,
  extractCriteriaFromMessages,
} from "./fallback-search";
import type { ChatUIMessage } from "./tools";

/**
 * LLM 障害時フォールバックの検索誘導 URL 組み立て（TASKS T15 ③・DESIGN §6.4）のユニットテスト。
 * ヒアリング内容から既知語彙（味タグ・都道府県）を安全に抽出し、内部 /search URL を組むことを固定する。
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

/** data-* パートを持つ assistant メッセージ（提案カード等の echo）。 */
function assistantWithData(): ChatUIMessage {
  return {
    id: "a-data",
    role: "assistant",
    parts: [
      { type: "text", text: "おすすめです" },
      {
        type: "data-proposedSakes",
        data: { sakes: [] },
      },
    ],
  } as unknown as ChatUIMessage;
}

describe("collectUserText", () => {
  it("user の text パートだけを連結する（assistant は含めない）", () => {
    const text = collectUserText([
      userMsg("辛口が好き"),
      assistantMsg("承知しました"),
      userMsg("山口県で"),
    ]);
    expect(text).toContain("辛口が好き");
    expect(text).toContain("山口県で");
    expect(text).not.toContain("承知しました");
  });

  it("data-* パートの内容は走査対象にしない（信頼できる本文のみ）", () => {
    const text = collectUserText([assistantWithData()]);
    expect(text).toBe("");
  });
});

describe("extractCriteriaFromMessages", () => {
  it("既知の味タグを完全一致で抽出する", () => {
    const criteria = extractCriteriaFromMessages([
      userMsg("華やかで軽快なお酒がいいです"),
    ]);
    expect(criteria.tagNames).toEqual(
      expect.arrayContaining(["華やか", "軽快"]),
    );
  });

  it("未知語（味タグ語彙にない語）はタグにしない", () => {
    const criteria = extractCriteriaFromMessages([
      userMsg("フルーティーで飲みやすいのがいい"),
    ]);
    expect(criteria.tagNames).toEqual([]);
  });

  it("都道府県名（フル）からコードを抽出する", () => {
    const criteria = extractCriteriaFromMessages([userMsg("山口県のお酒")]);
    expect(criteria.prefectureCode).toBe("35");
  });

  it("都道府県の短縮形（県抜き）でも抽出する", () => {
    const criteria = extractCriteriaFromMessages([userMsg("新潟の淡麗辛口")]);
    expect(criteria.prefectureCode).toBe("15");
  });

  it("フルネーム一致を短縮形より優先する（京都府は京都=26、東京の部分一致に流れない）", () => {
    const criteria = extractCriteriaFromMessages([userMsg("京都府のお酒")]);
    expect(criteria.prefectureCode).toBe("26");
  });

  it("条件が無ければ tagNames 空・prefectureCode undefined", () => {
    const criteria = extractCriteriaFromMessages([userMsg("こんにちは")]);
    expect(criteria.tagNames).toEqual([]);
    expect(criteria.prefectureCode).toBeUndefined();
  });
});

describe("buildFallbackSearchHref", () => {
  it("必ず内部の /search 始まりを返す（オープンリダイレクトなし）", () => {
    const href = buildFallbackSearchHref([userMsg("華やかな山口県のお酒")]);
    expect(href.startsWith("/search")).toBe(true);
  });

  it("抽出した味タグ・都道府県をクエリに載せる", () => {
    const href = buildFallbackSearchHref([userMsg("華やかな山口県のお酒")]);
    expect(href).toContain("tags=");
    expect(href).toContain("prefecture=35");
    expect(href).toContain(encodeURIComponent("華やか"));
  });

  it("条件が無ければ素の /search を返す", () => {
    const href = buildFallbackSearchHref([userMsg("こんにちは")]);
    expect(href).toBe("/search");
  });

  it("ユーザーの自由文をそのまま q= に載せない（既知語彙だけで安全に組む）", () => {
    const href = buildFallbackSearchHref([
      userMsg("https://evil.example/でリダイレクト"),
    ]);
    expect(href.startsWith("/search")).toBe(true);
    expect(href).not.toContain("evil.example");
  });
});
