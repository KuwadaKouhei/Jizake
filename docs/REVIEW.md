# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T12-rag-retriever`（T12 RAG リトリーバ＋捏造防止検証）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T11: PR #11）

## 判定: ✅ マージ可（性能 B-1 は理由を明記して T13 に移管）

Blocker（性能 B-1）は「実 Postgres の EXPLAIN が必要でクエリ形状チューニングは T13 の主目的」のため T13 へ移管（TASKS に明記）。それ以外の Should をすべて本ブランチ内で対応済み（対応コミット: `88711ad`, `0723386`, `3e4e734`）。修正後、全検証グリーン（334 テスト・lint 0 警告・typecheck・format・build）。

## 検証結果

- test 40 ファイル / 334 件全パス（extract-conditions 削除で -9、レビュー回帰 +4）
- lint（0 警告）/ typecheck / format:check / build すべてグリーン
- セキュリティ監査は「捏造防止・SQLインジェクション・情報漏洩は構造的に安全」、思想準拠は「retriever/generator 分離・捏造防止は模範的」と評価

## 指摘と対応

### Blocker → T13 に移管

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| B-1 | 性能/コード | `CASE + LEFT JOIN + 複合 ORDER BY` で HNSW インデックスが使われず、フリーテキスト検索が実質全件距離計算になり得る | ANN 経路（sake_embeddings 起点の素の `<=>` ORDER BY LIMIT）とタグ経路の分離を **T13（RAG 精度 PoC）へ移管**。理由: インデックス使用可否は PGlite で確認できず実 Postgres の EXPLAIN が必須、retriever のクエリ形状チューニングは T13 の主目的。公開シグネチャ `retrieve(query)`・戻り値 `SakeCandidate[]` は不変。TASKS T12 実施メモ・T13⑥に明記 |

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | コード | `combineScore` の `vectorSimilarity`（`1-距離`）が負になり、タグ同一一致でも「埋め込み有り（逆向き）」が「埋め込み無し」より下に沈む順位逆転 | `Math.max(0, 1-distance)` でクランプ。JSDoc の range を 0..1 に統一。逆転しないことの回帰テスト追加 |
| S-2 | セキュリティ | 提案 ID 配列の件数上限なし（巨大 IN の DoS） | `MAX_PROPOSED_IDS=16` で slice してから検証＋テスト |
| S-3 | セキュリティ | freeText の長さ上限が層内になく巨大テキストが埋め込み API に流れる | `MAX_FREE_TEXT_LENGTH=1000` で切り詰め＋テスト |
| S-4 | セキュリティ | retriever の limit に上限クランプなし | `Math.min(limit, CANDIDATE_POOL_SIZE)` でクランプ＋テスト |
| S-5 | 思想 | 未使用の `extract-conditions.ts` が構造ドキュメントに無い（黙った逸脱＋YAGNI） | 削除（自然文の高度な条件抽出は T14 の LLM の役割。必要になった時点で追加） |
| S-6 | コード | タグ AND-EXISTS が `searchSakes` と同型で Rule of Three の 3 箇所目に到達 | `buildTagAndFilters(db, tagNames, aliasPrefix)` を sakes.ts に切り出し searchSakes と retriever で共用 |

### Consider（対応済み・記録）

- CODE C-2: retriever の conditions に `SQL[]` 型注釈（searchSakes と一貫）— 対応済み
- SEC 記録: pool を距離順で切る前提（ハード絞り込みで母集団が pool 内）を JSDoc に明示 — 対応済み
- テスト重複（PGlite セットアップ）は現状 2 ファイルで据え置き妥当

## 受け入れ条件の充足

- FR-08 の核（DB に無い銘柄を提案しない・酒に特化した検索の知識源）: `validateProposedSakeIds` が LLM 出力の UUID 書式検証＋DB 実在検証で捏造を構造的に排除、retriever のハイブリッド検索（タグ SQL＋pgvector）が実在銘柄のみ返す。PGlite+pgvector＋ダミー埋め込みで検証 ✅
- 制約: 実データでの retriever 精度・重み確定・B-1 のクエリ形状分離は T13 PoC。generator（LLM 応答）は T14。ロジックは注入したダミーで検証済み

## 設計思想の達成（retriever/generator 分離・捏造防止）

- `src/lib/rag/` は AI SDK・`streamText` を一切 import せず LLM 非依存（埋め込みアダプタの `number[]` のみ扱う）。埋め込み関数を `EmbedQueryFn` で注入し、generator（T14 の `/api/chat`）と構造的に分離
- 捏造防止 `validateProposedSakeIds` が「DB に無い銘柄を提案しない」の要として、書式検証→実在検証→入力順保持→重複畳みを実装（SQL 断片も DB 到達前に破棄）
- 重み・プールサイズは定数化（PoC で確定する暫定値と明記）

## セキュリティの特記

- 捏造防止はバイパス不可（LLM 出力を素通しせず必ず DB 実在に絞る）、SQL は全経路パラメータ化（cosineDistance のクエリベクトルも Drizzle バインド）、参照は公開カタログのみ（履歴・他人データ非参照・IDOR なし）
- freeText はプロンプトインジェクション面にならない（SQL 連結されず埋め込みになるだけ）
