import { createHash } from "node:crypto";

import { EMBEDDING_DIMENSIONS } from "@/lib/ai/models";

/**
 * 決定的ダミー埋め込み（PoC 評価ハーネスの実キー不在時フォールバック。TASKS T13②）。
 *
 * 実 API キー（AI Gateway）が無い環境でも評価ハーネスが「動く・指標が計算される」ことを
 * 確認するための決定的な擬似埋め込み。**精度の絶対値は無意味**（意味空間を再現しない）だが、
 * - 同じテキストは常に同じベクトルになる（決定的＝再現可能）
 * - 単位ベクトルに正規化する（cosine 距離が安定）
 * - 文字 3-gram のハッシュを次元へ分散させる（語彙が重なるテキスト同士がやや近くなる）
 * ため、ハーネスの配線（retriever へ注入 → 距離計算 → 指標集計）の end-to-end 検証に使える。
 *
 * 実埋め込みでの精度実測は実キー投入後の作業（docs/RAG_POC.md の残作業に明記）。
 * 本番の retriever は src/lib/ai/embedding.ts の embedText（実 API）を使い、この関数は使わない。
 */

/** 文字列 → 32bit 符号なし整数（決定的ハッシュ。次元インデックスの分散に使う）。 */
function hashToIndex(token: string, salt: number): number {
  const digest = createHash("sha256").update(`${salt}:${token}`).digest();
  // 先頭 4 バイトを 32bit 整数として読む
  return digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
}

/** テキストの文字 3-gram を列挙する（日本語は空白区切りが乏しいため文字 n-gram）。 */
function charNgrams(text: string, n: number): string[] {
  const normalized = text.trim();
  if (normalized.length < n) {
    return normalized.length > 0 ? [normalized] : [];
  }
  const grams: string[] = [];
  for (let i = 0; i <= normalized.length - n; i++) {
    grams.push(normalized.slice(i, i + n));
  }
  return grams;
}

/**
 * テキストから決定的な 1536 次元の単位ベクトルを作る。
 *
 * 文字 3-gram ごとに 2 つの次元（正・負のスパイス付き）へ値を加算し、L2 正規化する。
 * 語彙の重なるテキスト同士は同じ次元に加算が集中しやすく cosine 類似度が上がる
 * （擬似的な語彙一致。意味的類似ではない）。ゼロベクトルは規定の単位ベクトルにフォールバック。
 */
export function fakeEmbedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const grams = charNgrams(text, 3);

  for (const gram of grams) {
    const idxA = hashToIndex(gram, 1);
    const idxB = hashToIndex(gram, 2);
    vector[idxA] += 1;
    // 2 つ目の次元は符号を散らして分布を広げる
    vector[idxB] += hashToIndex(gram, 3) % 2 === 0 ? 1 : -1;
  }

  // L2 正規化（cosine 距離を安定させる）。ゼロベクトルは 0 次元に 1 を立てる。
  let norm = 0;
  for (const v of vector) {
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  for (let i = 0; i < vector.length; i++) {
    vector[i] = vector[i] / norm;
  }
  return vector;
}
