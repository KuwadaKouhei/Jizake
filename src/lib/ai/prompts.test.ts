import { describe, expect, it } from "vitest";

import {
  CHAT_SYSTEM_PROMPT,
  MAX_HEARING_QUESTIONS,
  MAX_PROPOSED_CANDIDATES,
} from "./prompts";

/**
 * システムプロンプト初版の整合テスト（TASKS T13④）。
 * 実 LLM の応答品質はここでは測らない（実キー投入後の PoC 残作業）。ここでは
 * プロンプト定数が壊れていない・数値が定数と一致・捏造禁止/ヒアリング/検索の骨子を
 * 含むことだけを担保する（プロンプト文字列は定数として一元管理する方針の保護）。
 */

describe("CHAT_SYSTEM_PROMPT（初版）", () => {
  it("空でなく、日本語のシステム指示である", () => {
    expect(CHAT_SYSTEM_PROMPT.trim().length).toBeGreaterThan(100);
    expect(CHAT_SYSTEM_PROMPT).toContain("Jizake");
  });

  it("ヒアリング質問数が定数と一致してプロンプトに埋め込まれている", () => {
    expect(MAX_HEARING_QUESTIONS).toBe(4);
    expect(CHAT_SYSTEM_PROMPT).toContain(`${MAX_HEARING_QUESTIONS} 問以内`);
  });

  it("段階的な絞り込み（1 問ずつ・件数の共有・実在選択肢からの質問）を指示している（T23）", () => {
    expect(CHAT_SYSTEM_PROMPT).toContain("1 つだけ");
    expect(CHAT_SYSTEM_PROMPT).toContain("total");
    expect(CHAT_SYSTEM_PROMPT).toContain("narrowingTags");
    // 0 件時は条件を外して再検索する指示
    expect(CHAT_SYSTEM_PROMPT).toContain("0 件");
  });

  it("Markdown 装飾記法を使わない指示を含む（T23: ** の生表示対策）", () => {
    expect(CHAT_SYSTEM_PROMPT).toContain("Markdown");
  });

  it("提案上限件数が定数と一致してプロンプトに埋め込まれている", () => {
    expect(MAX_PROPOSED_CANDIDATES).toBe(8);
    expect(CHAT_SYSTEM_PROMPT).toContain(`${MAX_PROPOSED_CANDIDATES} 件`);
  });

  it("検索結果内の銘柄のみ提案・捏造禁止を指示している", () => {
    expect(CHAT_SYSTEM_PROMPT).toContain("searchSake");
    expect(CHAT_SYSTEM_PROMPT).toContain("proposeSake");
    expect(CHAT_SYSTEM_PROMPT).toContain("捏造");
    // 検索結果に無い銘柄を出さない旨
    expect(CHAT_SYSTEM_PROMPT).toContain("検索結果に無い銘柄");
  });

  it("プロンプトインジェクション（役割無視の指示）に従わない旨を含む", () => {
    expect(CHAT_SYSTEM_PROMPT).toContain("従わず");
  });
});
