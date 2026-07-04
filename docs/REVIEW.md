# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T05-sake-detail`（T05 日本酒詳細ページ）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T04: PR #4）

## 判定: ✅ マージ可

Blocker 0 件。Should 6 件はすべて本ブランチ内で対応済み（対応コミット: `fix: T05 レビュー指摘対応`）。修正後、全検証グリーン（105 テスト・lint・typecheck・format・build）。

## 検証結果

- test 15 ファイル / 105 件全パス
- lint / typecheck / format:check / build すべてグリーン
- `/sake/[id]` は `ƒ (Dynamic)`（revalidate=3600）、ページ固有クライアント JS ほぼゼロ（全 RSC）
- `dangerouslySetInnerHTML` はコードベース全体で不使用、外部リンクは https 限定＋rel=noopener noreferrer

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | コード/性能 | `getSakeDetail` が generateMetadata と本体で二重呼び出しされ 1 リクエスト 4 クエリになる | `React.cache` でラップしメモ化（同一リクエストで DB アクセス 1 回に集約） |
| S-2 | 性能 | 外部リンクに base-ui の Button を使い不要なクライアントランタイム（約6.7KB）を持ち込む | `buttonVariants` の className を素の `<a>` に当てる方式に変更 |
| S-3 | セキュリティ | `next.config` にセキュリティヘッダ（CSP/HSTS/X-Frame-Options 等）が無い | `X-Frame-Options: DENY`・`nosniff`・`Referrer-Policy`・`Permissions-Policy`・`poweredByHeader:false` を全ルートに付与 |
| S-4 | セキュリティ/コード | UUID 検証がコメントで v4 を謳うが任意バージョンを通す | version/variant ニブルを固定し v4 に限定。非 v4 棄却の負テスト追加 |
| S-5 | コード | 空文字 description 時にメタ description フォールバックが効かない（`??` は null のみ） | `.trim()` 判定に変更 |
| S-6 | 思想 | SakeCard を利用画面 0 のまま共有配置＝Rule of Three の逸脱記録なし | DIRECTORY_STRUCTURE §7 に「設計時点で 4 画面共用確定＝先行配置」を逸脱記録として明文化 |

### Consider（引き継ぎ・記録）

- **CSP / HSTS（T08 認証 or デプロイ時）**: 今回は壊れやすい CSP を避け基本ヘッダのみ導入。CSP（nonce 対応）と HSTS（HTTPS 本番前提）は認証/デプロイ整備時に追加
- **T06 以降**: `SakeTagList` の category による種別/味わい出し分け（現在は名前のみ描画）、`SakeCard` に推薦理由バッジ用の任意 slot を非破壊で足す余地
- **将来**: `generateStaticParams` によるカタログの静的化（SEO/初速の詰め）、フレーバー正規化ロジックが 3 箇所目に出たら `src/lib/` へ抽出

## 受け入れ条件の充足

- FR-01（詳細取得・表示）・FR-02（詳細でタグ一覧）・FR-03（`/sake/[id]` 直アクセス・外部リンク別タブ・欠損時非表示・価格帯表示）: クエリ・コンポーネント・ページの各テストでカバー ✅
- 制約: Supabase 実プロジェクト未作成のため実データ表示は残作業。クエリは PGlite で検証済み

## 各観点の総評

- **セキュリティ**: XSS 経路なし（React エスケープ徹底）、外部リンク https 二重正規化、Amazon 検索 URL は `URLSearchParams` でエンコード、IDOR なし（カタログ公開 SELECT の範囲のみ）
- **性能**: 全 RSC・画像/Webフォント不使用で CLS/LCP リスク構造的に低い、N+1 なし（詳細1+タグ1の2クエリ、React.cache で重複解消）
- **思想**: 配置・命名・依存方向・テスト方針すべて準拠。db 注入分離は「テスト容易性のための最小分離」で早すぎる抽象化ではない
