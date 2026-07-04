import { expect, test } from "@playwright/test";

import { hasAiGateway } from "./_support/env";

/**
 * 導線③: チャット 1 往復（FR-08 の回帰保証）。
 *
 * キー有無での分割:
 * - 安定動線（キー無しでも 200・DB/LLM 非依存）:
 *   1) /chat の入力 UI（見出し・初期ヒアリング文・メッセージ入力欄・送信ボタン）が表示される。
 *   2) `/api/chat` を Playwright でモックした UIMessageStream に差し替え、ユーザー送信 →
 *      アシスタント応答テキスト → 検証済み提案カード（/sake/[id] リンク）まで 1 往復を検証する
 *      （サーバの LLM・DB を一切叩かないので実キー無しの CI でも安定して通る。TASKS: 「LLM は
 *      モックエンドポイント」。ここでは Route Handler ごとネットワーク層でモックする）。
 * - フルフロー（要 AI_GATEWAY_API_KEY）: 実 LLM への 1 メッセージ送信→ストリーミング応答。
 *   実キーが要るため、キーがあるときだけ実行する（test.skip(!hasAiGateway)）。
 */

test.describe("導線③ チャット（安定動線: 入力 UI 表示）", () => {
  test("/chat に見出し・初期ヒアリング文・入力欄・送信ボタンが表示される", async ({
    page,
  }) => {
    await page.goto("/chat");

    // LCP 要素（見出し）は RSC で即時表示される。
    await expect(
      page.getByRole("heading", { name: "日本酒をチャットで相談", level: 1 }),
    ).toBeVisible();

    // ChatContainer は ssr:false の dynamic import。クライアントで初期ヒアリング文・入力欄が出る。
    await expect(page.getByText("どんなお酒を求めていますか？")).toBeVisible();
    await expect(page.getByLabel("メッセージを入力")).toBeVisible();
    await expect(page.getByRole("button", { name: "送信" })).toBeVisible();
  });
});

test.describe("導線③ チャット 1 往復（モックエンドポイント）", () => {
  test("送信→アシスタント応答テキスト→検証済み提案カードが表示される", async ({
    page,
  }) => {
    // /api/chat を UIMessageStream（AI SDK v6 の SSE プロトコル）でモックする。
    // サーバの LLM・retriever・DB 検証を経ずに、UI 側の 1 往復（送信→テキスト→data part カード）
    // の配線だけを黒箱で検証する。data-proposedSakes はサーバが「検証済み」として送るパートと
    // 同型で、UI は SakeCard（/sake/[id] リンク）で描画する。
    const sakeId = "11111111-1111-4111-8111-111111111111";

    await page.route("**/api/chat", async (route) => {
      // AI SDK v6 UIMessageStream の SSE イベント列（data: <json>\n\n）。
      // message id は AI SDK が自動採番するためイベントには載せない。
      const events = [
        { type: "start" },
        { type: "start-step" },
        { type: "text-start", id: "t1" },
        {
          type: "text-delta",
          id: "t1",
          delta: "ご希望に合いそうな日本酒をご提案します。",
        },
        { type: "text-end", id: "t1" },
        {
          type: "data-proposedSakes",
          data: {
            sakes: [
              {
                id: sakeId,
                name: "モック純米大吟醸",
                breweryName: "テスト酒造",
                prefectureCode: "13",
                tags: [],
              },
            ],
          },
        },
        { type: "finish-step" },
        { type: "finish" },
      ];
      const body =
        events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
        "data: [DONE]\n\n";

      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body,
      });
    });

    await page.goto("/chat");
    await expect(page.getByLabel("メッセージを入力")).toBeVisible();

    await page
      .getByLabel("メッセージを入力")
      .fill("辛口で食事に合う日本酒を探しています");
    await page.getByRole("button", { name: "送信" }).click();

    // アシスタントの応答テキストが表示される（プレーンテキスト）。
    await expect(
      page.getByText("ご希望に合いそうな日本酒をご提案します。"),
    ).toBeVisible();

    // 検証済み提案カード（SakeCard）が /sake/[id] リンクで描画される。
    await expect(page.getByText("おすすめの日本酒")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /モック純米大吟醸/ }),
    ).toHaveAttribute("href", `/sake/${sakeId}`);
  });
});

test.describe("導線③ チャット 1 往復（フルフロー・要 AI_GATEWAY_API_KEY）", () => {
  test.skip(
    !hasAiGateway,
    "AI_GATEWAY_API_KEY 未設定。実 LLM への 1 往復はキーがある環境でのみ実行する。",
  );

  test("実 LLM に 1 メッセージ送信するとアシスタント応答が返る", async ({
    page,
  }) => {
    await page.goto("/chat");
    await expect(page.getByLabel("メッセージを入力")).toBeVisible();

    await page
      .getByLabel("メッセージを入力")
      .fill("辛口で食事に合う日本酒を教えてください");
    await page.getByRole("button", { name: "送信" }).click();

    // 自分の送信メッセージが会話に出る。
    await expect(
      page.getByText("辛口で食事に合う日本酒を教えてください"),
    ).toBeVisible();

    // 実 LLM のストリーミング応答（ヒアリングの返答または提案）が現れるまで待つ。
    // 応答内容は非決定的なので「何らかのアシスタント発話が出る」ことを確認する。
    // ユーザー吹き出し（.ml-auto）と区別し、アシスタント側（.mr-auto）のテキストのみを
    // 対象にする（.whitespace-pre-wrap はユーザー吹き出しにも付くため。REVIEW T16 CODE S-1）。
    const assistantText = page.locator(".mr-auto .whitespace-pre-wrap").first();
    await expect(assistantText).toBeVisible({ timeout: 30_000 });
    await expect(assistantText).not.toHaveText("");
  });
});
