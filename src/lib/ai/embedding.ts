import { createHash } from "node:crypto";

import { embed, embedMany, gateway } from "ai";

import { findPrefectureByCode } from "@/lib/constants/prefectures";

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID } from "./models";

/**
 * 埋め込みアダプタ（AI SDK 呼び出しをここに集約。DIRECTORY_STRUCTURE §5.2）。
 *
 * - AI SDK の import はこのディレクトリと src/app/api/chat のみに許可される。
 * - Web（RAG のクエリ埋め込み）とバッチ（scripts/embed.ts の説明文埋め込み）で共用する。
 * - モデル ID は models.ts の定数（Gateway 経由の provider/model 文字列）。
 * - API キーは環境変数 AI_GATEWAY_API_KEY でのみ扱う（シークレット直書き禁止・
 *   CODING_PHILOSOPHY 秘密情報）。キーは gateway プロバイダが実行時に参照するため、
 *   import・ビルド時には要求しない（未設定でもモジュール読み込みは壊れない）。
 *   実際の埋め込み呼び出し時に未設定なら明確なエラーにする。
 */

/**
 * 埋め込み対象テキストの組み立て入力。DB スキーマには依存しない純粋な形にし、
 * 呼び出し側（scripts/embed.ts）が銘柄行から詰める。
 */
export type EmbeddingSource = {
  name: string;
  breweryName: string;
  prefectureCode: string;
  description: string;
  tagNames: readonly string[];
};

/**
 * 埋め込み対象テキストを 1 本に組み立てる純関数（DESIGN §2.7）。
 *
 * 銘柄名・蔵元・都道府県・説明文・タグを検索意図に沿う自然な日本語文脈にまとめる。
 * ラベル付き（「銘柄:」等）で並べるのは、text-embedding-3-small が短い日本語でも
 * 各要素の役割を捉えやすくするため。タグは決定性のため名前順にソートし、
 * 空要素（都道府県未解決・タグなし）は行ごと省く。
 *
 * この関数の出力が sourceHash の入力になるため、要素の順序・区切りが変わると
 * 全銘柄が再埋め込み対象になる（差分判定の基準を安定させる意図でも純関数化する）。
 */
export function buildEmbeddingText(source: EmbeddingSource): string {
  const prefectureName = findPrefectureByCode(source.prefectureCode)?.name;
  const sortedTags = [...source.tagNames].sort((a, b) =>
    a.localeCompare(b, "ja"),
  );

  const lines: string[] = [
    `銘柄: ${source.name}`,
    `蔵元: ${source.breweryName}`,
  ];
  if (prefectureName !== undefined) {
    lines.push(`都道府県: ${prefectureName}`);
  }
  lines.push(`説明: ${source.description}`);
  if (sortedTags.length > 0) {
    lines.push(`タグ: ${sortedTags.join("、")}`);
  }
  return lines.join("\n");
}

/**
 * 埋め込み対象テキストの SHA-256 ハッシュ（hex）を計算する純関数（DESIGN §2.7）。
 *
 * 同一テキストなら同一ハッシュ・テキストが変われば別ハッシュになり、
 * embed.ts の差分再埋め込み（sake_embeddings.source_hash との比較）の基準になる。
 */
export function computeSourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 生成された埋め込みベクトルの次元を検証する。想定次元（1536）と違えば
 * 格納前に明確なエラーにする（モデル差し替えでの次元不一致を早期検出）。
 */
function assertDimensions(embedding: number[]): number[] {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `埋め込み次元が想定と異なります（期待: ${EMBEDDING_DIMENSIONS}, 実際: ${embedding.length}, モデル: ${EMBEDDING_MODEL_ID}）`,
    );
  }
  return embedding;
}

/**
 * 単一テキストを埋め込む（RAG のクエリ埋め込み等で使用）。
 *
 * DESIGN §5.3 の `embedText(text): Promise<number[]>` を満たす。AI Gateway 経由で
 * text-embedding-3-small を呼ぶ。AI_GATEWAY_API_KEY 未設定時は AI SDK が実行時に
 * 認証エラーを投げる（握りつぶさず伝播させる）。
 */
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: gateway.textEmbeddingModel(EMBEDDING_MODEL_ID),
    value: text,
  });
  return assertDimensions(embedding);
}

/**
 * 複数テキストをまとめて埋め込む（バッチ埋め込み。scripts/embed.ts で使用）。
 *
 * AI SDK の embedMany は 1 リクエストで複数値を送れるため API 往復を抑えられる。
 * 返り値は入力順を保つ（AI SDK の契約）。
 */
export async function embedTexts(
  texts: readonly string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await embedMany({
    model: gateway.textEmbeddingModel(EMBEDDING_MODEL_ID),
    values: [...texts],
  });
  return embeddings.map((embedding) => assertDimensions(embedding));
}

/**
 * embed.ts が受け取る埋め込み関数の型。実 API（embedTexts）を注入する経路と、
 * テストで決定的なフェイクベクトルを注入する経路を切り替えるための境界
 * （TEST_PHILOSOPHY: LLM/埋め込み API はテストで叩かず注入で差し替える）。
 */
export type EmbedTextsFn = (texts: readonly string[]) => Promise<number[][]>;
