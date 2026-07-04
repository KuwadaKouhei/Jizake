# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T16-e2e`（T16 E2E テスト整備・主要3導線）
> 実施日: 2026-07-05
> レビュアー: code-reviewer / security-auditor / philosophy-compliance-reviewer（3ペルソナ並行。UI/データの性能変更がないため性能監査は省略）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T15: PR #15）

## 判定: ✅ マージ可

Blocker 0 件。Should をすべて本ブランチ内で対応済み（対応コミット: `fix: T16 レビュー指摘対応`）。修正後、全検証グリーン（ユニット 423・E2E 6 passed / 4 skipped・lint 0 警告・typecheck・format・build）。

## 検証結果

- unit test 55 ファイル / 423 件全パス（E2E は Vitest 対象外）
- E2E（実データ/実キー無し）: 6 passed / 4 skipped（安定動線が通り、フルフローは条件付き skip）
- lint / typecheck / format:check / build すべてグリーン
- 思想準拠は「高い準拠度・E2E は主要3導線のみで薄く・skip を正直に運用」、セキュリティは「シークレット直書きなし・最小権限・モックは信頼境界内」と評価

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | コード | フルフローのチャット検証が `.whitespace-pre-wrap.first()` でユーザー吹き出しにマッチし、実 LLM 応答を検証できていない（skip 中で気づけず「壊れても緑」になる） | アシスタント側（`.mr-auto` 配下）のテキストに限定＋非空を検証。未使用 `messageId` も削除 |
| S-2 | コード | README のポート指定が `PLAYWRIGHT_PORT`（config の単一情報源）と不整合 | README に「起動ポートは `PLAYWRIGHT_PORT`（既定 3100）」を明記 |
| S-3 | コード | auth フルフローの `waitForLoadState("networkidle")` が他 spec の role/text 方針とずれる（Playwright 非推奨） | 観測可能な要素（ログアウト表示 or `role=status`/`role=alert`）待ちに置換 |
| S-4 | セキュリティ | e2e ジョブに `permissions` 明示がない（トップレベル継承はされているが自己文書化のため） | e2e ジョブに `permissions: contents: read` を明示（defense-in-depth）＋将来フルフロー Secrets 登録時に trace artifact を再評価する注記 |

### Consider（対応済み・記録）

- 検索フルフローの特定銘柄依存（0 件許容分岐は既にあり）、signup の `getByLabel` 部分一致、SSE モックの SDK プロトコル依存は skip ゲート下で実害小。SDK 更新時の回帰確認対象として記録
- 思想: `retries: 2`（CI）はインフラ瞬断吸収用でフレーキー常態化を許すものでない旨（main から既存・本 PR 未変更）

## 受け入れ条件の充足

- 主要 3 導線の E2E（検索→一覧→詳細・ログイン・チャット1往復）: 安定動線（DB/キー無しでも通る画面到達）を常時検証し、実データ/実キー依存のフルフローは `test.skip(!process.env.X)` で条件付き実行。チャット1往復は `page.route` の SSE モックで安定動線化（TEST_PHILOSOPHY「LLM は必ずモック」）✅
- CI: `checks` と分離した並列 `e2e` ジョブ（unit の速度維持）、Chromium 1 ブラウザ、Secrets 未登録なら安全に skip でグリーン、実キー投入時に自動でフルフローが有効化 ✅

## 実データ/実キーが無い環境での画面到達（build&start 実測）

- 200: `/prefectures`（静的）・`/login`・`/signup`・`/chat`
- 307: 未ログイン `/history` → `/login?next=%2Fhistory`（proxy ガードが DB 非依存で機能）
- 500（フルフロー skip 対象）: `/`・`/search`・`/sake/[id]`・`/prefectures/[code]`（recommend/retriever が DB を要求）

## 設計・思想の特記

- 安定動線／フルフローの 2 層分割と `test.skip` ゲート、`e2e/_support/env.ts` への判定集約が一貫。skip 理由・実行手順を `e2e/README.md` に正直に記録（誤魔化しでない）
- webServer を `next build && next start`（本番挙動）に切替（T05 の申し送り対応）、readiness を DB 非依存の `/prefectures` に向けて DB 無しでも起動判定を通す
- 待機は role/text ベースで sleep 不使用、E2E は主要3導線のみ（TEST_PHILOSOPHY の比率方針）

## 残作業（実キー投入後）

- フルフロー E2E（検索・ログイン・チャット実 LLM 往復）は Supabase/AI Gateway の Secrets 登録で自動有効化。CI で trace artifact のアクセス範囲を再評価
