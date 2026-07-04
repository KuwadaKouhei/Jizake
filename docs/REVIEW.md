# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T11-embedding-pipeline`（T11 埋め込みパイプライン）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / philosophy-compliance-reviewer（3ペルソナ並行。バッチスクリプトで UI 変更がないため性能監査は省略）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T10: PR #10）

## 判定: ✅ マージ可

Blocker 0 件。Should をすべて本ブランチ内で対応済み（対応コミット: `fix: T11 レビュー指摘対応`）。修正後、全検証グリーン（309 テスト・lint・typecheck・format・build）。

## 検証結果

- test 40 ファイル / 309 件全パス（T11 で +19）
- lint / typecheck / format:check / build すべてグリーン（API キー未設定でも build 成功）
- git 全履歴のシークレット走査: クリーン（実 API キー混入なし）
- 思想準拠は「差し替え可能な知能・ベンダー型閉じ込め・LLM API モックいずれも高水準」と評価

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | コード | `embedTexts` が常に `EMBEDDING_MODEL_ID` を使うため、`embedSakes` の `model` 引数（差分判定・DB 記録に使用）と乖離しうる（生成モデルと記録モデルの二重真実） | `model` を `EmbedTextsFn` の引数としてスレッドし、生成と記録で同一値を使うよう一元化。生成モデル＝記録モデルの一致をテストで検証 |
| S-2 | セキュリティ | 埋め込み失敗ログに AI SDK エラー全体（`responseBody`・`requestBodyValues`・ヘッダ＝トークン断片や本文）が載り得る | ログを `error.message` のみに絞る |
| S-3 | セキュリティ | git 履歴に実 API キーが無いか要確認 | 全履歴走査を実施しクリーンを確認（対応不要と確定） |

### Consider（対応済み・記録）

- CODE C-1: DATABASE §2.10 の model 記録例を Gateway 形式 `openai/text-embedding-3-small` に更新 — 対応済み
- CODE C-2: 注入経路（フェイク）が誤った次元を返しても vector(1536) 列へ入れないよう、`embedSakes` の upsert 直前に次元検証を追加 — 対応済み
- CODE C-4: バッチ部分適用が冪等再実行で継続する意図を docstring に明記 — 対応済み
- 記録のみ: `ai@^6.0.219` はキャレット指定のため `npm ci`＋CI `npm audit` を継続、`loadExistingEmbeddings` の全件 Map は現規模で妥当

## 受け入れ条件の充足

- FR-08 の基盤（RAG の知識源となる埋め込みの生成・格納）: 説明文つき銘柄の差分埋め込み（sourceHash）＋冪等 upsert を PGlite（+pgvector）で検証。1536 次元の格納・モデル差し替え再生成・タグ変化検知をテスト ✅
- 制約: 実 API での埋め込み生成は AI Gateway キー＋Supabase 稼働後（残作業）。日本語埋め込み精度の検証は T13 の PoC。ロジックは注入したフェイクベクトルで検証済み

## 設計思想の達成（差し替え可能な知能・RAG 版）

- AI SDK の import を `src/lib/ai/embedding.ts` の 1 箇所に閉じ込め（DIRECTORY_STRUCTURE §5.2）。UI・スクリプトはアプリ内型のみ扱う
- モデルは AI Gateway の `provider/model` 文字列（`models.ts` 定数）で、切替が定数変更で完結
- 埋め込み関数を `EmbedTextsFn` で注入する境界により、実 API とテスト用フェイクを差し替え可能（retriever・generator 分離の準備）
- 純関数（`buildEmbeddingText`・`computeSourceHash`）と DB/API 実装を分離、差分基準を「埋め込み対象テキスト全体」に統一（DESIGN §2.7 に理由を記録）

## セキュリティ・思想の特記

- シークレット直書きなし、`.env.example` は空プレースホルダ、キーは gateway プロバイダが実行時参照（import/build を壊さない）
- 送信データは公開表示前提の非機微データ（銘柄・説明文・タグ）、SQL は全経路パラメータ化
- テストは実 API を叩かずフェイクベクトル注入（TEST_PHILOSOPHY「LLM API は必ずモック」に準拠）
