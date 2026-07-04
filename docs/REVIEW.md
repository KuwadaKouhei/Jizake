# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T02-db-schema`（T02 DB 基盤）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1）

## 判定: ✅ マージ可

Blocker 0 件。Should 6 件はすべて本ブランチ内で対応済み（対応コミット: `40938bc`, `d660846`）。

## 検証結果

- lint / typecheck / format:check / test（42 件全パス）/ build すべてグリーン
- schema.ts は DATABASE.md §2〜§4 と**カラム単位で完全一致**（CHECK 8・UNIQUE 4・FK・インデックス 10 本の DESC 指定まで照合済み）
- RLS ポリシー 9 本＋sake_embeddings 全拒否＋書き込みポリシーなしは §4.2 と一致。バイパス経路なし
- git 履歴全体のシークレット走査: クリーン
- DB コードはどのルートからも未 import でクライアントバンドル影響ゼロ（全ルート Static のまま）

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| 1 | 性能/コード | 接続プールが既定値（max=10・idle_timeout=0）でサーバレスの接続枯渇・バッチのプロセス残留を招く | `max: 1`（`DB_POOL_MAX` で可変）・`idle_timeout: 20`・`connect_timeout: 10`・`closeDb()` を追加 |
| 2 | コード/性能 | モジュールレベルキャッシュが dev HMR でプールをリークする | `globalThis` キャッシュに変更 |
| 3 | セキュリティ | Client Component 誤 import 時の実行時ガードがない | `typeof window` ガードを追加 |
| 4 | コード | DB 直接 ping では無料枠の無操作判定をリセットしない可能性 | PostgREST 経由の ping を主に変更＋実効性確認を残作業に記録 |
| 5 | 性能 | .env.example が Session pooler 前提で Vercel 本番の接続モードが曖昧 | 「本番は必ず Transaction pooler（6543）」と明記 |
| 6 | 思想 | 直前タスクの状態更新が feature ブランチに同乗する運用が規約外／`ci:` prefix が規約外 | GIT_CONVENTIONS に両方を明文化（運用の合法化） |

### Consider（引き継ぎ）

- **T03（バッチ実装時）**: `drizzle.config.ts` の DATABASE_URL 未設定時エラーの改善、`sql.raw` に流す定数のエスケープ or 形式アサーション
- **T07（検索実装時）**: `search_histories` の CHECK は空文字 query を許容する。Server Action 側で trim→NULL 化する
- **T08 以降（実 Supabase 適用時）**: `handle_new_user()` の EXECUTE を REVOKE、`sake_embeddings` へのテーブル権限 REVOKE（RLS の二層目）、`auth.users` トリガが実環境で作成できることの確認、ping 用 secret は低権限ロール推奨
- **テスト強化（任意）**: インデックス DESC の検証、RLS ポリシー `qual` 本体の照合、migrate 2 回実行の冪等性テスト
- **改行コード**: `.gitattributes`（`* text=auto eol=lf`）を追加済み。以後 EOL 差分ノイズは発生しない

## 受け入れ条件の充足

- FR-01（DB 格納の受け皿）: 10 テーブル＋マイグレーション 3 本＋`db:generate`/`db:migrate` ✅
- 非機能「履歴は本人のみ参照可能」: RLS ポリシーで DB 層の二段目を実装（主防御はサーバ側フィルタ、T09 で実装） ✅
- 制約: Supabase 実プロジェクト未作成のため、実環境適用は残作業として TASKS.md に記録（PGlite で DDL 検証済み）

## 思想準拠の特記

- DATABASE.md との食い違いなし（「写経レベルで忠実」と評価）。意図的非正規化 2 箇所も決定番号参照コメント付き
- テスト用 DB = PGlite の決定を TEST_PHILOSOPHY へ昇格（本レビューで指摘→対応）
