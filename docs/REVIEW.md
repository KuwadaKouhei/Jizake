# レビュー・監査結果（REVIEW）

> 対象: `main...feature/T08-auth`（T08 認証 Supabase Auth）
> 実施日: 2026-07-04
> レビュアー: code-reviewer / security-auditor / philosophy-compliance-reviewer（3ペルソナ並行。UI/データ量が小さいため性能監査は省略）
> ※ 過去のレビュー結果は git 履歴を参照（T01: PR #1 〜 T07: PR #7）

## 判定: ✅ マージ可

Blocker 0 件。Should をすべて本ブランチ内で対応済み（対応コミット: `fix: T08 レビュー指摘対応`）。修正後、全検証グリーン（218 テスト・lint・typecheck・format・build）。

## 検証結果

- test 29 ファイル / 218 件全パス（T08 で +41）
- lint / typecheck / format:check / build すべてグリーン（env 未設定でも build 成功＝遅延取得の意図どおり）
- セキュリティ監査で「認証設計は @supabase/ssr 公式パターンに忠実、Blocker なし」

## 指摘と対応

### Blocker

なし。

### Should（すべて対応済み）

| # | 出所 | 指摘 | 対応 |
|---|---|---|---|
| S-1 | コード | メール確認 ON 時、signUp 成功でセッション未発行なのに `/`（や `/history`）へ遷移し、middleware に弾かれる不可解な導線 | `data.session === null` を検出したらリダイレクトせず「確認メール送信」案内を表示。運用設定への依存を実装で吸収 |
| S-2 | コード | signup フォームの password が `autoComplete="current-password"`・`minLength` ハードコード | `passwordAutoComplete`/`passwordMinLength` を props 化。登録は `new-password`、最小長は `PASSWORD_MIN_LENGTH` と一元化 |
| S-3 | セキュリティ | `isProtectedPath` が大文字小文字を区別せず `/History` でバイパスされる理論的余地（ページ側再検証で実害は緩和済み） | `toLowerCase()` 正規化で保護を安全側に広く倒す＋テスト |
| S-4 | コード | `redirectToLogin` が文字列を `?` で split して URL 再構築（`&` 混入時に壊れやすい） | `URL`/`searchParams.set` に変更しエンコードを担保 |

### Consider（記録）

- **ログインのレート制限**: アプリ側は未実装だが Supabase Auth 側のサーバレベル制限に一次依存。DESIGN §6.2「乱用が観測されてから追加」方針どおりで対応不要（記録のみ）
- **未使用の `client.ts`（browser クライアント）**: @supabase/ssr 標準一式として DIRECTORY_STRUCTURE §2・TASKS T08① に明記済みの先行配置。T09 以降で購読に使う想定
- **CSP/HSTS**: 認証ページ含む CSP/HSTS は本ブランチ範囲外。デプロイ整備時に検討（T05 で基本ヘッダは導入済み）

## 受け入れ条件の充足

- FR-04（メールでサインアップ/ログイン/ログアウト、未ログインで履歴・パーソナライズにアクセスすると誘導）: Server Actions＋@supabase/ssr、`/history` 保護（middleware＋ページ側の多層防御）、`/login?next=` 誘導をテストで担保 ✅
- 非機能「資格情報のハッシュ化・シークレット非コミット」: パスワードは Supabase 委任、anon key のみ使用（service_role 混入なし）、git 履歴クリーン ✅
- 制約: 実キーでのサインアップ/ログイン疎通・profiles トリガ・Confirm email 設定確認は Supabase 稼働後の残作業（TASKS 記録）。ロジックは純関数＋モックで検証済み

## セキュリティ総評（認証の要点）

- **サーバ検証 `getUser()` を一貫使用**（未検証 `getSession()` に認可を委ねない）
- **オープンリダイレクト対策**: `sanitizeRedirectPath` が絶対 URL・`//`・バックスラッシュ・制御文字を弾き、サーバ側で再検証（多層防御）
- **情報漏洩防止**: ログイン失敗はアカウント存在を推測させない固定文言、エラーは汎用化
- **Cookie は @supabase/ssr 既定の httpOnly/secure/SameSite**、Server Actions の CSRF 耐性

## 思想準拠の特記

- `@supabase/*` import を `src/lib/auth/` の 3 ファイルに閉じ込め、UI にはアプリ内型 `AuthUser` のみ露出（ベンダー型の閉じ込め）
- Progressive Personalization（原則5）を「仕組みで」担保: env 未設定でも匿名機能が生存、保護は `/history` のみ
- `middleware.ts`→`src/proxy.ts` 改名・`/history` ガード先行有効化・エラー文言汎用化はすべて実施メモ＋ドキュメントに記録（黙った逸脱なし）
