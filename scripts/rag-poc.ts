import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { embedText } from "@/lib/ai/embedding";
import { closeDb, getDb } from "@/lib/db/client";
import type { EmbedQueryFn } from "@/lib/rag/retriever";

import { EVAL_CASES } from "./lib/rag-eval/eval-set";
import { fakeEmbedText } from "./lib/rag-eval/fake-embedding";
import { type EvalReport, runEval } from "./lib/rag-eval/harness";

/**
 * RAG 精度 PoC の実行スクリプト（使い捨て。TASKS T13 ②④⑤）。
 *
 * 評価セット（10 質問 × 期待銘柄）に対し retriever を走らせ、recall@k / MRR / hit@k を
 * 計測して標準出力にレポートする。
 *
 * - **実 API キー（AI_GATEWAY_API_KEY）があれば実埋め込み**（embedText）でクエリを埋め込み、
 *   実データ（Supabase・投入済み `sake_embeddings`）に対する日本語検索精度を実測する。
 * - **無ければ決定的ダミー埋め込み**（fakeEmbedText）で動く。この場合は精度の絶対値は無意味だが、
 *   ハーネスが動く・指標が計算されることを確認できる（指示: 実/ダミー両対応）。
 *
 * このスクリプトは Web アプリのビルド対象に含めない（scripts/ 配下・next build 非対象。
 * DIRECTORY_STRUCTURE §3）。指標の絶対値の確定は実キー投入後（docs/RAG_POC.md の残作業）。
 *
 * 実行:
 *   npm run rag:poc          # 実キーがあれば実埋め込み、無ければダミー
 *   RAG_POC_FORCE_FAKE=1 ... # 実キーがあっても強制的にダミー（配線確認用）
 */

function formatReport(report: EvalReport, mode: "real" | "fake"): string {
  const lines: string[] = [];
  lines.push("==== RAG 精度 PoC レポート ====");
  lines.push(
    `埋め込み: ${mode === "real" ? "実 API（AI Gateway / text-embedding-3-small）" : "決定的ダミー（精度の絶対値は無意味）"}`,
  );
  lines.push(`評価質問数: ${report.metrics.queryCount} / k=${report.k}`);
  lines.push("");
  for (const c of report.cases) {
    const rank =
      c.result.firstHitRank === null ? "圏外" : `${c.result.firstHitRank} 位`;
    lines.push(
      `- ${c.label}\n    hit@${report.k}=${c.result.hit ? "○" : "×"} recall=${c.result.recall.toFixed(2)} 初ヒット=${rank} 候補数=${c.candidateCount} 期待解決=${c.resolvedExpectedCount}`,
    );
  }
  lines.push("");
  lines.push(
    `平均 recall@${report.k}: ${report.metrics.meanRecallAtK.toFixed(3)}`,
  );
  lines.push(`MRR: ${report.metrics.mrr.toFixed(3)}`);
  lines.push(`hit@${report.k} 率: ${report.metrics.hitRateAtK.toFixed(3)}`);
  if (report.unresolvedExpectedNames.length > 0) {
    lines.push("");
    lines.push(
      `⚠ 未解決の期待銘柄（seed-data に無い・要投入 or typo）: ${report.unresolvedExpectedNames.join(" / ")}`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const forceFake = process.env.RAG_POC_FORCE_FAKE === "1";
  const hasKey = Boolean(process.env.AI_GATEWAY_API_KEY);
  const useReal = hasKey && !forceFake;

  const embedQuery: EmbedQueryFn = useReal
    ? (text) => embedText(text)
    : async (text) => fakeEmbedText(text);

  if (!useReal) {
    console.warn(
      hasKey
        ? "RAG_POC_FORCE_FAKE=1 のため決定的ダミー埋め込みで実行します（配線確認）。"
        : "AI_GATEWAY_API_KEY が未設定のため決定的ダミー埋め込みで実行します（精度の絶対値は無意味。実測は実キー投入後）。",
    );
  }

  // DATABASE_URL 未設定ならここで明確に失敗する（実データ評価には実 DB が要る）。
  const db = getDb();
  const report = await runEval(db, embedQuery, EVAL_CASES);
  console.log(formatReport(report, useReal ? "real" : "fake"));
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  void (async () => {
    try {
      await main();
    } catch (error) {
      // AI SDK のエラーは requestBody 等に埋め込みテキストを保持しうるため message のみ出す
      // （ログ経由の情報漏洩防止。REVIEW T11 SEC S-1 と同姿勢）。
      const message = error instanceof Error ? error.message : String(error);
      console.error("RAG 精度 PoC の実行に失敗しました:", message);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  })();
}
