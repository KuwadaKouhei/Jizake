# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T03-import-sakenowa`（T03 さけのわデータインポート）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1、T02: PR #2）

## 判定: ✅ マージ可

Blocker 1 件・Should 6 件・Consider 3 件をすべて本ブランチ内で対応済み（対応コミット: `d113ba3`, `6484bb2`）。修正後、全検証グリーン（65 テスト・lint・typecheck・format・build）。

## 検証結果

- test 9 ファイル / 65 件全パス（インポート統合テスト 5→10 件に増強）
- lint / typecheck / format:check / build すべてグリーン
- 冪等 upsert・manual 保全・重複統合・ランキング洗い替えを PGlite 統合テストで実証

## 指摘と対応

### Blocker（対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| B-1 | コード | 重複蔵元の統合先が「配列内で最初に出現した蔵元」で非決定的。順序変化・統合先 ID の API 消失で `UNIQUE(name, prefecture_code)` 違反となりインポートが恒久失敗（FR-01「再実行可能」に抵触。PGlite で再現済み） | 統合先を `(prefecture_code, name)` グループの最小 sakenowa ID に固定（順序非依存）＋ upsert 前に DB 既存行を照会して統合先を優先／既存 uuid へ統合。回帰テスト 2 本追加（順序入替・統合先消失） |

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | コード | `sake_tags` の `DELETE WHERE source='sakenowa'` が全銘柄対象で、スナップショットから消えた銘柄のタグを永久破壊 | DELETE を今回 upsert した銘柄の `sake_id IN (...)` に限定。タグ非破壊の assertion 追加 |
| S-2 | コード | 手作業銘柄と同一 `(brewery_id, name)` の銘柄が API に現れると UNIQUE 違反で全体失敗 | upsert 前に DB 既存 `(brewery_id, name)` と突合しスキップ＋件数ログ。手作業説明文が無傷であることをテスト |
| S-3 | コード | 「内容が揺らぐ再実行」「不明 tagId 参照」のテスト欠落 | 順序入替・統合先消失・不明 tagId の合成スナップショットテスト追加 |
| S-4 | セキュリティ | 外部 API 文字列に長さ上限なし／`brand.name` が未トリム（蔵元と非対称） | Zod 名前系を `z.string().trim().max(200)` に統一。銘柄名は trim 後空文字をスキップ |
| S-5 | 思想 | `SAKENOWA_API.md` の flavor-tags 件数が自己矛盾（242 vs 実測 141） | 全箇所を 141 に修正 |
| S-6 | 思想 | レビュー引き継ぎのコード修正の PR 同乗が規約の明文範囲外 | GIT_CONVENTIONS に「小規模なら次タスク PR 冒頭コミットに同乗可、大規模は fix/ ブランチ」を追記 |

### Consider（すべて対応済み）

- C-1: ランキング洗い替え前に `popularity_rank` を一括 NULL 化（スナップショット外の幽霊ランク解消）
- C-2: DESIGN §2.7 の味タグ例示を実タグ名（華やか/芳醇/重厚/穏やか/ドライ/軽快）に修正
- C-3: 直接実行の後始末を `try/catch/finally` に変更し `closeDb()` を確実に await

### 各観点の Blocker なし項目

- **性能**: バルク upsert（1,000 行チャンク・N+1 なし）で実行時間 1 分未満の見込み。Blocker/Should なし
- **セキュリティ**: SQL は全経路 Drizzle パラメータ化。`sql.raw` は schema.ts の 1 箇所（形式アサーション付き）。fixtures に PII・シークレットなし

## 受け入れ条件の充足

- FR-01（データ投入が再実行可能）: 冪等 upsert＋順序非依存の統合で、再実行時も同一状態に収束（B-1 修正で恒久失敗の穴を解消） ✅
- FR-02（タグ付与）: さけのわタグ＋フレーバー6軸→味タグ機械変換、`source` で手作業タグを保全 ✅
- 制約: Supabase 実プロジェクト未作成のため実データ投入は残作業（TASKS.md 記録）。DDL/ロジックは PGlite で検証済み

## 引き継ぎ（下流タスク）

- **T04（手作業シード）**: sakes/breweries のセカンダリ UNIQUE との衝突に留意（本 PR でスキップガードは実装済み）
- **T06 以降（UI）・T14（RAG）**: `sakes.name` / `tags.name` は信頼できない外部入力。`dangerouslySetInnerHTML` を使わない・LLM プロンプト埋め込み時に留意
