import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";
import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  buildEmbeddingText,
  computeSourceHash,
  embedTexts,
  type EmbedTextsFn,
} from "@/lib/ai/embedding";
import { EMBEDDING_MODEL_ID } from "@/lib/ai/models";
import { closeDb, getDb } from "@/lib/db/client";
import { selectTagsBySakeIds } from "@/lib/db/queries/sakes";
import * as schema from "@/lib/db/schema";
import { breweries, sakeEmbeddings, sakes } from "@/lib/db/schema";

/**
 * 説明文の差分埋め込みパイプライン（DESIGN §2.7・§6.3・TASKS T11）。
 *
 * - 説明文（description）を持つ全銘柄について、埋め込み対象テキスト
 *   （銘柄名＋蔵元＋都道府県＋説明文＋タグ）を組み立て、その SHA-256 を
 *   sake_embeddings.source_hash と比較する。
 * - **未登録・source_hash が変化・model が変化** した銘柄のみ再埋め込みして upsert
 *   する（差分埋め込みでコスト最小化。DESIGN §6.3）。
 * - 埋め込み生成（AI Gateway 呼び出し）は embedTexts を注入して差し替え可能にし、
 *   テストでは決定的なフェイクベクトルを注入する（実 API は叩かない。TEST_PHILOSOPHY）。
 * - closeDb を try/finally で必ず呼ぶ（既存 seed.ts / import-sakenowa.ts と同型）。
 */

// PostgresJsDatabase（本番）と PgliteDatabase（テスト）の両方を受けるための共通型
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

// 1 バッチで埋め込み API に送る銘柄数（API 往復・リクエストサイズの抑制）。
const EMBED_BATCH_SIZE = 100;
// upsert の 1 チャンクあたり行数（postgres のパラメータ上限に対する余裕）。
const UPSERT_CHUNK_SIZE = 500;

/** 埋め込み対象の銘柄行（description は非空が保証された状態で扱う）。 */
export type EmbeddingCandidate = {
  sakeId: string;
  name: string;
  breweryName: string;
  prefectureCode: string;
  description: string;
  tagNames: string[];
};

/** 差分判定の結果（再埋め込みが必要な銘柄と、その対象テキスト・ハッシュ）。 */
export type EmbeddingWorkItem = {
  sakeId: string;
  text: string;
  sourceHash: string;
};

export type EmbedSummary = {
  candidates: number;
  reused: number;
  embedded: number;
};

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

/**
 * 差分判定の純関数（ユニットテスト対象・TASKS T11 ④）。
 *
 * 各候補の埋め込みテキストと source_hash を組み立て、既存の埋め込み
 * （sakeId → { sourceHash, model }）と突き合わせて、再埋め込みが必要なものだけ返す。
 * 再埋め込みが必要なのは次のいずれか:
 *   - 既存埋め込みが無い（未登録）
 *   - source_hash が変化した（説明文・タグ・蔵元・都道府県が変わった）
 *   - model が現行モデルと異なる（モデル差し替え。DATABASE.md §2.10）
 */
export function selectWorkItems(
  candidates: readonly EmbeddingCandidate[],
  existing: ReadonlyMap<string, { sourceHash: string; model: string }>,
  model: string,
): EmbeddingWorkItem[] {
  const work: EmbeddingWorkItem[] = [];
  for (const candidate of candidates) {
    const text = buildEmbeddingText({
      name: candidate.name,
      breweryName: candidate.breweryName,
      prefectureCode: candidate.prefectureCode,
      description: candidate.description,
      tagNames: candidate.tagNames,
    });
    const sourceHash = computeSourceHash(text);
    const prev = existing.get(candidate.sakeId);
    const needsEmbedding =
      prev === undefined ||
      prev.sourceHash !== sourceHash ||
      prev.model !== model;
    if (needsEmbedding) {
      work.push({ sakeId: candidate.sakeId, text, sourceHash });
    }
  }
  return work;
}

/** description を持つ銘柄と蔵元名・都道府県・タグを取得する（DB アクセス）。 */
export async function loadCandidates(db: Db): Promise<EmbeddingCandidate[]> {
  const rows = await db
    .select({
      sakeId: sakes.id,
      name: sakes.name,
      breweryName: breweries.name,
      prefectureCode: breweries.prefectureCode,
      description: sakes.description,
    })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    // 説明文が無い銘柄は埋め込み対象にしない（RAG の知識源は説明文）。
    .where(sql`${sakes.description} is not null and ${sakes.description} <> ''`)
    .orderBy(sakes.id);

  const sakeIds = rows.map((row) => row.sakeId);
  const tagsBySakeId = await selectTagsBySakeIds(db, sakeIds);

  return rows.map((row) => ({
    sakeId: row.sakeId,
    name: row.name,
    breweryName: row.breweryName,
    prefectureCode: row.prefectureCode,
    // where で非空を保証しているが、型上は string | null のため明示的に絞る。
    description: row.description ?? "",
    tagNames: (tagsBySakeId.get(row.sakeId) ?? []).map((tag) => tag.name),
  }));
}

/** 既存の埋め込み（sakeId → source_hash・model）を取得する（DB アクセス）。 */
export async function loadExistingEmbeddings(
  db: Db,
): Promise<Map<string, { sourceHash: string; model: string }>> {
  const rows = await db
    .select({
      sakeId: sakeEmbeddings.sakeId,
      sourceHash: sakeEmbeddings.sourceHash,
      model: sakeEmbeddings.model,
    })
    .from(sakeEmbeddings);
  return new Map(
    rows.map((row) => [
      row.sakeId,
      { sourceHash: row.sourceHash, model: row.model },
    ]),
  );
}

/** 埋め込みベクトルを sake_embeddings へ冪等 upsert する（sake_id 競合キー）。 */
async function upsertEmbeddings(
  db: Db,
  rows: readonly {
    sakeId: string;
    embedding: number[];
    sourceHash: string;
    model: string;
  }[],
): Promise<void> {
  for (const batch of chunk(rows, UPSERT_CHUNK_SIZE)) {
    await db
      .insert(sakeEmbeddings)
      .values(batch)
      .onConflictDoUpdate({
        target: sakeEmbeddings.sakeId,
        set: {
          embedding: sql`excluded.embedding`,
          model: sql`excluded.model`,
          sourceHash: sql`excluded.source_hash`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/**
 * 差分埋め込みの本体。候補取得 → 差分判定 → 変更行のみ埋め込み生成 → upsert。
 *
 * embed は埋め込み関数の注入口（本番は embedTexts、テストはフェイク）。
 * model はモデル ID（既定 EMBEDDING_MODEL_ID）。model カラムに記録して
 * 差し替え時の再生成判定に使う。
 */
export async function embedSakes(
  db: Db,
  embed: EmbedTextsFn,
  model: string = EMBEDDING_MODEL_ID,
): Promise<EmbedSummary> {
  const candidates = await loadCandidates(db);
  const existing = await loadExistingEmbeddings(db);
  const work = selectWorkItems(candidates, existing, model);

  let embedded = 0;
  for (const batch of chunk(work, EMBED_BATCH_SIZE)) {
    const vectors = await embed(batch.map((item) => item.text));
    if (vectors.length !== batch.length) {
      throw new Error(
        `埋め込み結果の件数が入力と一致しません（入力: ${batch.length}, 出力: ${vectors.length}）`,
      );
    }
    const rows = batch.map((item, index) => ({
      sakeId: item.sakeId,
      embedding: vectors[index],
      sourceHash: item.sourceHash,
      model,
    }));
    await upsertEmbeddings(db, rows);
    embedded += rows.length;
  }

  return {
    candidates: candidates.length,
    reused: candidates.length - work.length,
    embedded,
  };
}

function logSummary(summary: EmbedSummary): void {
  console.log("説明文の差分埋め込みが完了しました");
  console.log(`  対象銘柄（説明文あり）: ${summary.candidates} 件`);
  console.log(`  再利用（差分なし）: ${summary.reused} 件`);
  console.log(
    `  埋め込み生成・upsert: ${summary.embedded} 件（model=${EMBEDDING_MODEL_ID}）`,
  );
}

async function main(): Promise<void> {
  // drizzle.config.ts と同じ規約（.env.local 等）で DATABASE_URL・AI_GATEWAY_API_KEY を読む
  loadEnvConfig(process.cwd());
  // AI Gateway キー未設定なら埋め込みを生成できないため、DB を無駄に叩く前に落とす。
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "環境変数 AI_GATEWAY_API_KEY が設定されていません（.env.example 参照）。埋め込み生成には AI Gateway のキーが必要です。",
    );
  }
  // DATABASE_URL 未設定ならここで明確に失敗させる
  const db = getDb();
  const summary = await embedSakes(db, embedTexts);
  logSummary(summary);
}

// テストから embedSakes 等を import しても実行されないよう、
// 直接実行（npm run embed）のときだけ main を起動する
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  void (async () => {
    try {
      await main();
    } catch (error) {
      console.error("埋め込み生成に失敗しました:", error);
      process.exitCode = 1;
    } finally {
      // 接続プールを必ず閉じる（プロセス残留防止）
      await closeDb();
    }
  })();
}
