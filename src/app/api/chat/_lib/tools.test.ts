import type { ToolCallOptions } from "ai";
import { describe, expect, it, vi } from "vitest";

import type { SakeSummary } from "@/lib/db/queries/sakes";
import type { RetrieveQuery, SakeCandidate } from "@/lib/rag/retriever";

import {
  type ChatUIMessage,
  createChatTools,
  PROPOSED_SAKES_DATA_TYPE,
  proposeSakeInputSchema,
} from "./tools";

/**
 * generator のツール定義のユニットテスト（TASKS T14 ⑤）。
 *
 * 実 LLM・実 DB を叩かず、retriever / validateProposedSakeIds / writer を注入して検証する:
 *   (a) proposeSake の ID 検証で捏造（実在しない ID）が落ち、検証済みカードだけが
 *       データパートに載る（DESIGN §2.6 捏造防止の二段目）。
 *   (b) proposeSake の入力（structured output）を Zod で境界検証する。
 *   (c) searchSake が retriever を呼び、結果を LLM 向けに整形して返す。
 *
 * LLM 応答そのものは固定モック（ツールの execute を直接呼ぶ）で差し替え、実 API を叩かない
 * （TEST_PHILOSOPHY: LLM API は必ずモック。retriever・ID 検証は注入したフェイクで挙動を固める）。
 */

// tool.execute の第 2 引数（本テストでは中身を使わないので最小限を渡す）。
const toolOptions = {
  toolCallId: "test-call",
  messages: [],
} as unknown as ToolCallOptions;

/** writer のフェイク。書き込まれた data part を記録するだけ。 */
function createFakeWriter() {
  const written: unknown[] = [];
  const writer = {
    write: (part: unknown) => {
      written.push(part);
    },
    merge: () => {},
    onError: undefined,
  } as unknown as Parameters<typeof createChatTools>[0]["writer"];
  return { writer, written };
}

function makeSummary(id: string, name: string): SakeSummary {
  return {
    id,
    name,
    breweryName: "テスト酒造",
    prefectureCode: "35",
    tags: [
      { id: `tag-${id}`, name: "華やか", category: "taste", source: "manual" },
    ],
  };
}

function makeCandidate(id: string, name: string): SakeCandidate {
  return {
    sake: makeSummary(id, name),
    score: 0.9,
    vectorSimilarity: 0.8,
    matchedTagCount: 1,
  };
}

const REAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FAKE = "00000000-0000-4000-8000-000000000000";

describe("proposeSake（捏造防止の二段目）", () => {
  it("実在 ID のみを検証済みカードとしてデータパートに載せ、捏造 ID は除外する", async () => {
    const { writer, written } = createFakeWriter();
    // validator は実在する REAL_A / REAL_B だけを入力順で返す（FAKE は落とす）フェイク。
    const validateProposedSakeIds = vi.fn(async (ids: readonly string[]) => {
      const existing = new Map([
        [REAL_A, makeSummary(REAL_A, "獺祭")],
        [REAL_B, makeSummary(REAL_B, "而今")],
      ]);
      return ids
        .map((id) => existing.get(id))
        .filter((s): s is SakeSummary => s !== undefined);
    });

    const tools = createChatTools({
      writer,
      retrieve: vi.fn(),
      validateProposedSakeIds,
    });

    const result = await tools.proposeSake.execute!(
      {
        proposals: [
          { sakeId: REAL_A, reason: "華やか" },
          { sakeId: FAKE, reason: "幻の銘柄（捏造）" },
          { sakeId: REAL_B, reason: "食中酒に合う" },
        ],
      },
      toolOptions,
    );

    // validator には LLM が返した全 ID（捏造含む）が渡る。
    expect(validateProposedSakeIds).toHaveBeenCalledWith([
      REAL_A,
      FAKE,
      REAL_B,
    ]);
    // tool result には検証を通った件数（2）だけが返る。
    expect(result).toEqual({ proposedCount: 2 });

    // データパートには検証済みカードのみ・入力順で載る。FAKE は含まれない。
    expect(written).toHaveLength(1);
    const part = written[0] as {
      type: string;
      data: { sakes: SakeSummary[] };
    };
    expect(part.type).toBe(PROPOSED_SAKES_DATA_TYPE);
    expect(part.data.sakes.map((s) => s.id)).toEqual([REAL_A, REAL_B]);
  });

  it("全提案が捏造（検証で 0 件）ならデータパートを書かず proposedCount 0 を返す", async () => {
    const { writer, written } = createFakeWriter();
    const validateProposedSakeIds = vi.fn(async () => [] as SakeSummary[]);

    const tools = createChatTools({
      writer,
      retrieve: vi.fn(),
      validateProposedSakeIds,
    });

    const result = await tools.proposeSake.execute!(
      { proposals: [{ sakeId: FAKE, reason: "捏造" }] },
      toolOptions,
    );

    expect(result).toEqual({ proposedCount: 0 });
    // 0 件なら空のカードデータを載せない（UI で「提案なし」の扱いにできる）。
    expect(written).toHaveLength(0);
  });
});

describe("proposeSakeInputSchema（structured output の境界検証）", () => {
  it("proposals が最低 1 件・reason 非空なら通す", () => {
    const parsed = proposeSakeInputSchema.safeParse({
      proposals: [{ sakeId: REAL_A, reason: "華やか" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("proposals が空配列は弾く（提案は 1 件以上）", () => {
    const parsed = proposeSakeInputSchema.safeParse({ proposals: [] });
    expect(parsed.success).toBe(false);
  });

  it("reason が空文字は弾く", () => {
    const parsed = proposeSakeInputSchema.safeParse({
      proposals: [{ sakeId: REAL_A, reason: "" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("sakeId 欠落は弾く", () => {
    const parsed = proposeSakeInputSchema.safeParse({
      proposals: [{ reason: "理由だけ" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("searchSake（retriever を呼ぶ）", () => {
  it("入力条件で retriever を呼び、候補を ID・名前・タグに整形して返す", async () => {
    const { writer } = createFakeWriter();
    const retrieve = vi.fn<(query: RetrieveQuery) => Promise<SakeCandidate[]>>(
      async () => [
        makeCandidate(REAL_A, "獺祭"),
        makeCandidate(REAL_B, "而今"),
      ],
    );

    const tools = createChatTools({
      writer,
      retrieve,
      validateProposedSakeIds: vi.fn(),
    });

    const result = (await tools.searchSake.execute!(
      {
        freeText: "華やかで飲みやすい",
        tagNames: ["華やか"],
        prefectureCode: "35",
      },
      toolOptions,
    )) as { candidates: unknown[] };

    // retriever には検索条件がそのまま渡る（limit は候補上限が付与される）。
    expect(retrieve).toHaveBeenCalledTimes(1);
    const arg = retrieve.mock.calls[0]![0];
    expect(arg.freeText).toBe("華やかで飲みやすい");
    expect(arg.tagNames).toEqual(["華やか"]);
    expect(arg.prefectureCode).toBe("35");

    // LLM に返すのは実在 ID を含む整形済み候補（スコア等の内部値は含めない）。
    expect(result.candidates).toEqual([
      {
        sakeId: REAL_A,
        name: "獺祭",
        breweryName: "テスト酒造",
        prefectureCode: "35",
        tagNames: ["華やか"],
      },
      {
        sakeId: REAL_B,
        name: "而今",
        breweryName: "テスト酒造",
        prefectureCode: "35",
        tagNames: ["華やか"],
      },
    ]);
  });

  it("候補 0 件なら空配列を返す（LLM は条件緩和を促せる）", async () => {
    const { writer } = createFakeWriter();
    const retrieve = vi.fn<(query: RetrieveQuery) => Promise<SakeCandidate[]>>(
      async () => [],
    );

    const tools = createChatTools({
      writer,
      retrieve,
      validateProposedSakeIds: vi.fn(),
    });

    const result = (await tools.searchSake.execute!(
      { freeText: "存在しない条件" },
      toolOptions,
    )) as { candidates: unknown[] };
    expect(result.candidates).toEqual([]);
  });
});

// 型の健全性（ChatUIMessage の data part 名が定数と一致すること）を型レベルでも固定する。
const _typeCheck: ChatUIMessage["parts"] = [];
void _typeCheck;
