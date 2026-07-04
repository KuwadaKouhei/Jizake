# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T01-project-setup`（T01 プロジェクト初期化）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / web-performance-auditor / philosophy-compliance-reviewer（4ペルソナ並行）

## 判定: ✅ マージ可

Blocker 0 件。Should 5 件は本ブランチ内で対応済み（対応コミット: `5cc7ae4`, `28cc98f`）。
残る指摘はすべて Consider（後続タスクでの対応で足りる提案）。

## 検証結果

- `npm test` 21/21 pass ／ lint ／ typecheck ／ format:check ／ `next build` すべてグリーン
- git 履歴全体のシークレットスキャン: クリーン（`.env.example` は空プレースホルダのみ）
- lockfile 健全（全依存が registry.npmjs.org・integrity あり）
- `/` と `/_not-found` は静的プリレンダー。クライアント JS 約 201KB gzip（FW 基準値）・CSS 6.4KB gzip

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| 1 | セキュリティ | CI に `permissions` 未指定（GITHUB_TOKEN が過剰権限になり得る） | `permissions: contents: read` を追加（`5cc7ae4`） |
| 2 | コード | Prettier を導入したのに CI ゲートに `format:check` が無い | CI にステップ追加（`5cc7ae4`） |
| 3 | 性能 | 未使用の Geist Mono が全ページで preload され約 29KB を浪費 | 読み込みごと削除（`5cc7ae4`） |
| 4 | コード/思想 | TASKS.md の T01 状態がマージ前に「完了」（規約の状態遷移と不整合） | 「レビュー中」へ是正。マージ時に「完了」とする（`28cc98f`） |
| 5 | コード/思想 | 未実施の T01⑦（Vercel 接続）の追跡先が無い | T02 の作業内容へ移管（`28cc98f`） |

### Should（追跡のみ・本ブランチでは対応不可）

| # | 出所 | 指摘 | 追跡方法 |
|---|---|---|---|
| 6 | セキュリティ | next 16.2.10 同梱 postcss < 8.5.10 に moderate の既知脆弱性（GHSA-qx2v-qp2m-jg93）。自前 CSS のみの現状で悪用可能性は低い | 修正版 Next.js 安定版が出たら更新。**`npm audit fix --force` は next@9 への破壊的ダウングレードを提案するため実行禁止**。リモート運用開始時に Dependabot 導入を推奨 |

### Consider（後続タスクへの引き継ぎ）

- **T02（DB・push 運用開始時）**: Dependabot/Renovate 導入、GitHub Actions の SHA ピン留め
- **T08（認証）まで**: `next.config.ts` にセキュリティヘッダ（`poweredByHeader: false`・nosniff・Referrer-Policy 等）
- **T16（E2E）**: Playwright `webServer` を `next build && next start` へ、`test:e2e` スクリプト追加
- **UI 実装タスク以降**: バンドルサイズの継続計測（First Load JS の差分確認）、error/not-found 等「全ルート常駐境界」の依存を軽く保つ
- **軽微（任意）**: `@types/node` を Node 22 に合わせる、定数の `as const satisfies` 化（都道府県コードの union 型導出）、中央寄せコンテナ class の重複（3箇所目だがプレースホルダ含みのため保留）、`components.json` の `hooks` エイリアスの生成先方針、和文フォントは OS フォールバック方針の明示（性能上は現状が最適）

## 受け入れ条件の充足

T01 は全 FR の土台タスクであり固有の FR 受け入れ条件を持たない。非機能要件は以下で確認:

- シークレット非コミット: `.gitignore`（`.env*`）＋履歴スキャンで確認 ✅
- 日本語 UI 基盤: `lang="ja"`（テストで固定） ✅
- さけのわ利用条件（帰属表示）: フッター常設＋リンク・文言・`rel=noopener` をテストで固定 ✅
- 「main は常に起動可能」: CI の build ゲートで機械的に担保 ✅

## 思想準拠の特記

- 規約変更 2 件（shadcn `cn.ts` の配置、CI build ゲート追加）は、いずれも同一ブランチで理由付きのドキュメント更新を伴っており「黙った逸脱」なし。
- モックは `next/font/google`（FW 境界）のみで TEST_PHILOSOPHY のモック方針に準拠。

## PR 提出

リモート `origin` は設定済み。push → PR 作成はメインセッションで実施（本書末尾のコマンド参照）。
**マージは人間が行う**（AI は main へマージしない）。

```
git push -u origin feature/T01-project-setup
gh pr create --title "T01: プロジェクト初期化（scaffold・CI・共通レイアウト）" --body <PR本文>
```
