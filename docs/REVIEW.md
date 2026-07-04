# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T04-seed-data`（T04 手作業シードデータ投入）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / philosophy-compliance-reviewer（3ペルソナ並行。UI 変更がないため性能監査は省略）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1、T02: PR #2、T03: PR #3）

## 判定: ✅ マージ可

Blocker 0 件。Should 3 件はすべて本ブランチ内で対応済み（対応コミット: `fix: T04 レビュー指摘対応`）。修正後、全検証グリーン（80 テスト・lint・typecheck・format・build）。

## 検証結果

- test 10 ファイル / 80 件全パス（seed 分 13→15 件に増強）
- lint / typecheck / format:check / build すべてグリーン
- シードデータ 76 銘柄・全 47 都道府県カバー・キー重複ゼロ・説明文はすべて自作
- T03 で指摘された 3 つの穴（タグ入れ替え範囲・セカンダリ UNIQUE 衝突・統合の非決定性）を構造的に回避済み（レビュアー実証）

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | セキュリティ | `z.url()` が `javascript:`/`data:`/`file:` 等の危険スキームを素通し（境界コメントと実挙動が乖離、将来の格納型 XSS の温床） | 外部 URL を `z.url({ protocol: /^https$/ })` で https 限定に。危険スキーム・http を弾く回帰テスト追加 |
| S-2 | コード | 種別タグ upsert の category 跨ぎ衝突が沈黙（種別語がさけのわ味タグと同名だと味タグ ID を黙って流用） | タグ解決を `category='type'` に限定し、解決不能なら明示エラーで停止。カテゴリ衝突の回帰テスト追加 |
| S-3 | コード | `rakuten_url` の「手作業カラム」列挙が import-sakenowa と食い違い（保守時に混乱） | seed.ts ヘッダに「rakuten_url は入力対象外・既存値は保全」と明記 |

### Consider（引き継ぎ・記録）

- **T11（3本目の投入スクリプト = 埋め込み）時**: `chunk`/`isDirectRun`/`Db` 型が import-sakenowa/seed/embed の 3 箇所目重複になる。Rule of Three 到達時に `scripts/lib/batch/` へ責務名で昇格を検討（現状 2 箇所は据え置きが妥当）
- **著作権（記録）**: 説明文は抜き取り確認で転載の兆候なし・一般的事実＋独自表現の範囲。評価的記述は事実ベースを維持する方針を継続
- **軽微**: 蔵元突き合わせキーの `name.trim()` を import 側と揃える（共存時の取りこぼし防止）、`seededSakeIds` の意図をコメント補足、エラーログを `error.message` 中心に（接続文字列漏えい予防）

## 受け入れ条件の充足

- FR-01（名称・蔵元・都道府県・説明文の充足、再実行可能な投入手順）: 76 銘柄の自作説明文＋冪等 upsert（2 回実行で UUID 含め同一状態をテスト）で充足 ✅
- 制約: Supabase 実プロジェクト未作成のため `npm run seed` の実投入は残作業（TASKS.md 記録）。ロジックは PGlite で検証済み

## 思想準拠の特記

- `seed-data/sakes.ts` はデータのみ（ロジックゼロを grep 確認）、検証は `scripts/lib/seed/schema.ts` に分離（DIRECTORY_STRUCTURE §3・DIR-7 準拠）
- import-sakenowa との重複は 2 箇所で Rule of Three 未達＝据え置きが思想どおり
- 説明文の自作方針（FEASIBILITY R2）をコード・スキーマ・テストの三重で強制
