# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T13-rag-poc`（T13 RAG 精度 PoC ＋ T12 B-1 移管）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T12: PR #12）

## 判定: ✅ マージ可

Blocker 0 件（T12 から移管された B-1 のクエリ形状は本タスクで解消）。Should をすべて本ブランチ内で対応済み（対応コミット: `fix: T13 レビュー指摘対応` 系）。修正後、全検証グリーン（363 テスト・lint 0 警告・typecheck・format・build）。

## 検証結果

- test 47 ファイル / 363 件全パス
- lint / typecheck / format:check / build すべてグリーン（scripts は本番バンドル対象外を実測確認）
- **性能: B-1 のクエリ形状は解消**（ANN 経路が素の `<=>` ORDER BY LIMIT）、思想準拠は「模範的」、セキュリティは「捏造防止 E2E は本物の防御を担保・Blocker/Should なし」と評価

## 指摘と対応

### Blocker（B-1 は本タスクで解消）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| B-1 | 性能（T12 移管） | HNSW が効かないクエリ形状（CASE+LEFT JOIN+複合 ORDER BY） | ANN 経路（`sake_embeddings` 起点の素の `<=>` ORDER BY LIMIT）とタグ経路（埋め込み無し銘柄を残す）に分離。機能等価を PGlite テストで担保、実 Postgres の EXPLAIN 確認手順（3 形状＋フォールバック）を RAG_POC.md §8.4 に記録 |

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | 性能 | タグ未指定＋freeText のみで母集団が最大 pool×2 に膨らむ | ハード絞り込み無し＋freeText のみ（純粋な意味検索）のときタグ経路を省き ANN のみに（母集団半減）。埋め込み無し銘柄は意味検索では拾わない挙動をテストで固定 |
| S-2 | コード | 「同じ候補・同じ順位」コメントが母集団拡大の境界ケースで過剰主張 | 「上位 limit 件は距離で等価・候補が limit 未満のとき下位の顔ぶれは母集団の取り方で変わり得る」に是正 |
| S-3 | コード | `compareScored` の名前タイブレークが SQL 照合順と厳密一致しない | id（UUID）で必ず決着する旨＋localeCompare は補助である旨をコメント明記 |
| S-4 | 性能 | フィルタ有り形状で HNSW が実データで残るか未確認 | RAG_POC.md §8.4 に 3 形状（無し/都道府県/タグ EXISTS）の個別 EXPLAIN 手順と、外れた場合の ANN 単独化フォールバック設計を記録 |
| S-5 | 思想 | scripts→`src/lib/rag` の import が DIRECTORY_STRUCTURE の許可列挙に無い | §5.2/§3/責務表に「PoC 評価で retriever を呼ぶ」許可を追記 |

### Consider（対応済み・記録）

- セキュリティ: `npm run rag:poc` の本番 DB 誤接続注意、T14 で `fabrication-guard` を本番スキーマに差し替える TODO、ハーネス撤去方針を RAG_POC.md に記録 — 対応済み
- コード C-1〜C-3（テスト説明の関数名併記・fake-embedding のハッシュ回数・匿名型）は使い捨て資産／局所利用のため据え置き妥当

## 受け入れ条件の充足

- FR-08（品質リスク R3/R4 の解消見込みの確定）: 評価ハーネス（recall@k/MRR/hit@k・実/ダミー両対応）、捏造防止 E2E（DB 非存在・UUID 非書式・実在混在）、B-1 のクエリ形状解消、初版システムプロンプトを整備 ✅
- 制約: 精度の絶対値・retriever 重みの確定・実 LLM 往復・実 Postgres の EXPLAIN は**実キー投入後の残作業**（RAG_POC.md §6 に明記）。ダミー埋め込みで確立したのは「ハーネスが動く・指標が計算される・実行手順」であり精度を誇張していない

## 設計思想の達成

- retriever は AI SDK・streamText を一切 import せず LLM 非依存（generator=T14 と分離）、埋め込みは `EmbedQueryFn` 注入
- B-1 対応でも公開シグネチャ `retrieve(query)`→`SakeCandidate[]` は不変（T12 移管条件を厳守）
- 捏造防止は「プロンプト一段目＋サーバ側 DB 存在検証二段目」の二段構え、重み・k・上限は定数化
- ダミー埋め込みの限界を RAG_POC.md・各テスト・スクリプトで繰り返し明記する誠実な文書化

## 次タスクへの引き継ぎ（T14）

- `src/lib/ai/prompts.ts` の初版システムプロンプト（ヒアリング 2〜3 問→検索→検索結果内の銘柄のみ提案・捏造禁止・インジェクション拒否）を使用
- `proposeSake` の structured output → `validateProposedSakeIds` で ID 検証してからカード送信
- 実キー投入後に retriever 重み確定・実 LLM 往復・B-1 の EXPLAIN 確認
