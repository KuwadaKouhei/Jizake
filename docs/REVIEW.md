# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T09-history`（T09 履歴記録と履歴画面）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T08: PR #8）

## 判定: ✅ マージ可

Blocker 1 件（セキュリティ）・Should をすべて本ブランチ内で対応済み（対応コミット: `fix: T09 レビュー指摘対応`）。修正後、全検証グリーン（254 テスト・lint・typecheck・format・build）。

## 検証結果

- test 35 ファイル / 254 件全パス（T09 で +36）
- lint / typecheck / format:check / build すべてグリーン
- IDOR/ユーザーデータ分離は「堅牢」（セキュリティ監査）、fire-and-forget・N+1 回避・RSC 純度も良好（性能）

## 指摘と対応

### Blocker（対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| B-1 | セキュリティ | `recordSearch` がクライアント由来の `criteria` をサーバ側で再検証せず jsonb に INSERT（自分の履歴への注入・肥大化。`recordView` の `isValidSakeId` と非対称） | `sanitizeCriteria`（検索 Zod スキーマを単一情報源に再利用）で q 長さ・タグ数/長さ・都道府県書式をサーバ側再検証してから INSERT。回帰テスト追加 |

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | コード/性能 | `getCurrentUser` が 1 リクエストで最大 3 回 `getUser()`（トークン検証の往復）を反復 | `React.cache` でラップ（全ページのヘッダー・ページ本体で 1 回に集約する横断改善） |
| S-2 | セキュリティ | fire-and-forget の失敗ログに `error` 全体（SQL パラメータ・query・filters）が載り得る | `error.message` のみに絞り、ユーザー入力をログに残さない |
| S-3 | セキュリティ | 味タグ 1 要素の長さが無制限 | `MAX_TAG_LENGTH=32` で各要素を切り詰め（B-1 の再検証と併せて jsonb 肥大化を防止） |
| S-4 | コード | 検索履歴ラベルのリスト key が配列インデックス | 位置＋値 `${i}-${label}` で一意化 |

### Consider（引き継ぎ・記録 → TASKS の非機能フォローに追記）

- **履歴書き込みのレート制限／重複抑制（SEC S-2 / PERF S-1）**: `view_histories` は追記専用（同一銘柄の複数閲覧を別行）で設計どおりだが、ヘビーユーザーで行数が膨らむと `count()`/`OFFSET` が劣化。DESIGN §6.2 の「乱用が観測されてから追加」方針に沿い、実データ稼働後に「直近 N 分の同一 sakeId は 1 行」等を検討。TASKS の非機能フォローに記録
- **履歴一覧のページャ UI（PERF C-1）**: クエリは `total`/`page`/`pageSize` を返すがページ側は 1 ページ固定。当面は直近 24 件表示で受け入れ条件（FR-05 前半）を満たす。keyset ページネーション化と併せて将来対応。page.tsx にコメントで明記
- **`filters` の型**: 公開境界で `unknown` ＋ `readFilters` の実行時ガード（DB を信頼しない姿勢として妥当）。将来 Zod スキーマ化の余地
- **RLS 二段目**: Drizzle のサーバ接続は RLS 素通しのため、実効防御は一段目（`getCurrentUser` からの user_id 強制）。DESIGN §6.2 で想定・文書化済み

## 受け入れ条件の充足

- FR-05 前半（詳細ページ閲覧と検索実行が履歴として記録される）: fire-and-forget Server Action で view/search を記録（未ログイン no-op・空条件スキップ）✅
- FR-04（未ログインで履歴にアクセスすると誘導）: T08 の `/history` 保護＋本タスクで実画面を表示 ✅
- 非機能「履歴は本人のみ参照可能」: user_id 強制フィルタ（主防御）＋ RLS（二段目）。他人の履歴が漏れないことを PGlite テストで検証 ✅
- 制約: 実データ記録疎通・RLS 実効遮断は Supabase 稼働後の残作業。ロジックは PGlite＋モックで検証済み

## セキュリティ総評（ユーザーデータ分離）

- 公開関数（`getViewHistoryPage`/`getSearchHistoryPage`/`recordView`/`recordSearch`）は user_id を引数で受けず `getCurrentUser` から強制取得＝クライアントから他人の user_id を渡す経路が型レベルで存在しない
- 記録は未ログイン no-op、`getUser()` のサーバ検証、Server Action の CSRF 耐性
- 退会時は `auth.users`→`profiles`→履歴の CASCADE で全削除、履歴に不要な個人情報を保存しない

## 思想準拠の特記

- 記録 Server Action を各セグメントの `_actions/` に、履歴クエリを `/history/_lib` にコロケーション
- 履歴 `_lib` → 検索 `_lib` の一方向参照（循環なし）を DIR-11・§5.2 例外として記録（「逸脱ルールが期待どおり機能した好例」と評価）
- fire-and-forget・追記専用イベントログ・user_id 二段防御は DESIGN §2.4/§6.2・決定 D3 どおり
