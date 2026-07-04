# タスク一覧（TASKS）— Jizake（日本酒レコメンドWebアプリ）

> 作成日: 2026-07-04
> 入力: `docs/DESIGN.md`（7コンポーネント・決定 D1〜D8）／`docs/REQUIREMENTS.md`（FR-01〜FR-08）／
> `docs/DATABASE.md`（10テーブル・インデックス・RLS）／`docs/DIRECTORY_STRUCTURE.md`（配置規則）／
> `docs/GIT_CONVENTIONS.md`（`feature/<ID>-<slug>`）／`docs/FEASIBILITY.md`（R3/R4 PoC 推奨）
> 前提: グリーンフィールド（既存コードなし）。自律実行モードのため、判断が必要な点は設計に沿って決定し、
> 理由を §4（分解上の判断）に記録した。

## 運用ルール

- **1タスク = 1機能 = 1ブランチ = 1PR**。ブランチ名は `feature/<ID>-<slug>`（GIT_CONVENTIONS）。
- 各タスクのマージ時点で `main` は**起動可能・テストグリーン**を保つ（未完成機能への導線は出さない／
  プレースホルダで塞ぐ）。
- 状態は `未着手` → `進行中` → `レビュー中` → `完了` で更新する。

---

## 1. タスク詳細

### T01: プロジェクト初期化（scaffold・CI・共通レイアウト）

| 項目 | 内容 |
|---|---|
| 概要 | Next.js（App Router）プロジェクトの scaffold、テスト・CI 基盤、全ページ共通レイアウトを作り、`main` を「起動可能・テストグリーン」の初期状態にする |
| 主な作業内容 | ① `git init`・`.gitignore`（`.env*` 除外）・`.env.example` ② `create-next-app`（TypeScript・Tailwind v4・`src/` 構成）＋ shadcn/ui 導入（`components.json`・`src/components/ui/`）③ Vitest（`vitest.config.ts`、E2E グロブ除外）・Playwright（`playwright.config.ts`・`e2e/` 空枠）・ESLint/typecheck の npm scripts ④ CI: `.github/workflows/ci.yml`（PR 毎に lint + typecheck + Vitest）⑤ 共通レイアウト: `src/app/layout.tsx`・`src/components/site-header.tsx`・`site-footer.tsx`（**さけのわ帰属表示＋ https://sakenowa.com リンク常設**）・`src/app/error.tsx`・`not-found.tsx`・ホーム `src/app/page.tsx`（プレースホルダ）⑥ ドメイン定数 `src/lib/constants/prefectures.ts`（JIS 47件）・`price-ranges.ts` |
| 受け入れ条件 | —（全 FR の土台。非機能: シークレット非コミット・レスポンシブ・日本語 UI の基盤） |
| 依存タスク | なし |
| ブランチ | `feature/T01-project-setup` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜⑥完了（Playwright は設定＋`e2e/` 空枠のみ。CI への E2E 組込は T16）。
> 旧⑦「Vercel プロジェクト接続」は push 運用が始まる T02 の①へ移管した（レビュー指摘 S-2）。

### T02: DB 基盤（Supabase・Drizzle スキーマ 10 テーブル・RLS）

| 項目 | 内容 |
|---|---|
| 概要 | Supabase プロジェクトを作成し、DATABASE.md の物理設計（10テーブル・インデックス・RLS・トリガ）をマイグレーションとして再現可能にする |
| 主な作業内容 | ① Supabase プロジェクト作成・接続情報を `.env.example` へ反映（＋リモート push 運用の開始と Vercel プロジェクト接続: T01 からの持ち越し）② `src/lib/db/schema.ts`（breweries / sakes / tags / sake_tags / profiles / view_histories / search_histories / chat_sessions / chat_messages / sake_embeddings。型の単一情報源）③ `src/lib/db/client.ts` ④ `drizzle.config.ts`・drizzle-kit で `drizzle/` に SQL 生成 ⑤ カスタム SQL マイグレーション: `CREATE EXTENSION vector`・RLS 有効化＋ポリシー（DATABASE §4.2）・`profiles` 自動作成トリガ・HNSW インデックス ⑥ DATABASE §3 のインデックス一式 ⑦ `.github/workflows/ping-supabase.yml`（無料枠 7 日停止対策の定期 ping） |
| 受け入れ条件 | FR-01（DB 格納の受け皿）、非機能「履歴は本人のみ参照可能」（RLS 二段目） |
| 依存タスク | T01 |
| ブランチ | `feature/T02-db-schema` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ②〜⑦完了。スキーマ検証は PGlite（インプロセス Postgres＋pgvector 拡張）で実施し、
> マイグレーション一式の適用・制約・トリガ・RLS DDL を `src/lib/db/schema.test.ts` で確認済み
> （auth スキーマ実体と RLS の実効遮断は Supabase 固有のためテスト対象外）。
> **残作業（① の一部。Supabase 実プロジェクト未作成のため持ち越し）**:
> 1. Supabase プロジェクト作成 → `.env.local` に接続情報を設定 → `npm run db:migrate` で適用
>    （詳細手順は `.env.example` のコメント参照）
> 2. GitHub Actions secrets `SUPABASE_URL`・`SUPABASE_ANON_KEY`（＋任意で `DATABASE_URL`）の登録
>    （ping-supabase.yml 用。未登録の間は安全にスキップ）
> 3. Vercel プロジェクト接続（T01 からの持ち越し。ダッシュボード操作が必要）
> 4. ping の実効性確認: 無操作判定は API アクティビティ基準の報告があるため、初回の停止期限（7日）前に
>    Supabase ダッシュボードで一時停止予告が出ていないことを確認する（レビュー指摘 CODE S-3）

### T03: さけのわデータインポート

| 項目 | 内容 |
|---|---|
| 概要 | さけのわ API から蔵元・銘柄・ランキング・フレーバーを取得し、冪等 upsert で DB に投入する（味タグの機械付与を含む） |
| 主な作業内容 | ① `scripts/lib/sakenowa/client.ts`（areas / brands / breweries / rankings / flavor-charts / brand-flavor-tags 取得）② `scripts/lib/sakenowa/schemas.ts`（レスポンスの Zod 検証）③ `scripts/lib/sakenowa/flavor-to-tags.ts`（6軸→味タグ変換の純関数。しきい値は定数）＋ `flavor-to-tags.test.ts`・`fixtures/` ④ `scripts/import-sakenowa.ts`（`sakenowa_brand_id` / `sakenowa_brewery_id` を競合キーに冪等 upsert。`sake_tags` は `source='sakenowa'` のみ入れ替え、`manual` を保全）⑤ `package.json` に `import:sakenowa` script ⑥ 冪等性テスト（2 回実行で同一状態） |
| 受け入れ条件 | FR-01（データ投入が再実行可能）、FR-02（タグ付与） |
| 依存タスク | T02 |
| ブランチ | `feature/T03-import-sakenowa` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜⑥完了。テストは PGlite（マイグレーション一式適用）＋実 API から取得した
> 代表サンプルのフィクスチャで実施（冪等性・manual 保全・手作業カラム非上書き・ランキング洗い替えを検証済み）。
> 実測で判明した例外データ（空文字名の蔵元 48 件・同一 (name, areaId) の重複蔵元 43 組）への対応
> （スキップ＋統合）を実装し、`docs/SAKENOWA_API.md` に追記した。
> T02 レビュー Consider の引き継ぎ（drizzle.config の DATABASE_URL 未設定エラー・sql.raw 形式アサーション）も
> 本ブランチで対応済み。
> **残作業**: Supabase 実プロジェクト作成後（T02 残作業）に `npm run import:sakenowa` で実データを投入する。

### T04: 手作業シードデータ投入

| 項目 | 内容 |
|---|---|
| 概要 | 自作説明文・種別タグ・読み仮名・公式 URL・価格帯を `seed-data/` に整備し、冪等 upsert で投入する（RAG・詳細ページの実データ源） |
| 主な作業内容 | ① `seed-data/` に JSON/TS でデータ整備（説明文は必ず自作＝著作権 R2。PoC を見据え**説明文つき銘柄を 50 件以上**用意）② `scripts/seed.ts`（`UNIQUE (brewery_id, name)` / `tags.name` を競合キーに冪等 upsert。種別タグは `source='manual'`）③ `package.json` に `seed` script ④ 冪等性テスト |
| 受け入れ条件 | FR-01（名称・蔵元・都道府県・説明文の充足、再実行可能な投入手順） |
| 依存タスク | T02（T03 と並行可） |
| ブランチ | `feature/T04-seed-data` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜④完了。`seed-data/sakes.ts` に主要銘柄 76 件（獺祭・久保田・
> 八海山・十四代・而今・新政・田酒・黒龍・飛露喜・鍋島 等、全 47 都道府県）を自作説明文つきで整備
> （説明文は一般に知られた特徴の範囲で自作＝著作権 R2 回避。捏造した受賞歴は書かない）。
> `scripts/lib/seed/schema.ts`（境界 Zod 検証）を さけのわ schemas.ts と同型で追加し、seed.ts と
> テストの両方で通す。`scripts/seed.ts` は UNIQUE(name, prefecture_code) / UNIQUE(brewery_id, name) /
> tags.name を競合キーに冪等 upsert し、さけのわ由来カラム・source='sakenowa' タグを保全する
> （T03 レビュー引き継ぎ: セカンダリ UNIQUE 衝突・手作業/機械タグ共存に対応）。
> テストは PGlite（マイグレーション一式適用）で冪等性・さけのわ共存・manual 付与を検証し、
> データファイルの妥当性（必須項目・都道府県 01..47・price_range CHECK 値・説明文非空・重複なし）も
> 純粋テストで確認（全 78 テストグリーン）。
> **残作業**: Supabase 実プロジェクト作成後（T02 残作業）に `npm run seed` で実データを投入する。

### T05: 日本酒詳細ページ

| 項目 | 内容 |
|---|---|
| 概要 | `/sake/[id]` で説明・タグ一覧・外部リンク・価格帯を表示する（カタログの最初の縦スライス） |
| 主な作業内容 | ① `src/lib/db/queries/sakes.ts`（詳細取得・`SakeSummary` 型。横断クエリ）② `src/app/sake/[id]/page.tsx`（RSC 直接クエリ、`revalidate = 3600`）③ `src/app/sake/[id]/_components/`（タグ一覧・外部リンク: `target="_blank" rel="noopener"`、`official_url`/`amazon_url` 欠損時は Amazon 検索 URL 生成 or 非表示、価格帯表示）④ `src/components/sake-card.tsx`（銘柄カード。以降の一覧・推薦・チャットで共用）⑤ 存在しない ID は `not-found` |
| 受け入れ条件 | FR-01（詳細が取得・表示できる）、FR-02（詳細でタグ一覧表示）、FR-03（全条件） |
| 依存タスク | T03, T04（表示する実データ） |
| ブランチ | `feature/T05-sake-detail` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜⑤完了。① `src/lib/db/queries/sakes.ts` に
> `getSakeDetail`（公開）/`selectSakeDetail`（db 注入・テスト用）を追加し、
> `SakeSummary`/`SakeDetail`/`FlavorChart`/`SakeTagSummary` 型を定義（銘柄＋蔵元 INNER JOIN、
> タグは category→name 順）。id は UUID 書式検証で不正値を DB 問い合わせ前に弾き 404 化。
> ② `src/app/sake/[id]/page.tsx` は RSC 直接クエリ・`revalidate=3600`・`generateMetadata` で
> 銘柄名タイトル。③ `_components/`（タグ一覧・説明〔whitespace-pre-line で改行保持のテキスト描画〕・
> フレーバー6軸バー・外部リンク）＋ `_lib/external-links.ts`（純関数。official/rakuten は欠損非表示、
> amazon は欠損時に銘柄名から検索 URL 生成、https 限定の防御的多重化）。外部リンクは
> `target="_blank" rel="noopener noreferrer"`。④ `src/components/sake-card.tsx`（共有カード。詳細へ Link）。
> ⑤ 存在しない/不正 id は `notFound()`。REVIEW T03/T04 引き継ぎ（外部入力の生 HTML 描画禁止・
> https 外部リンク）をコンポーネントとテストで担保。
> テストは PGlite（クエリ結合・NULL 可カラム・存在しない id）＋ RTL 相当の SSR 出力検証
> （カード・外部リンクの target/rel・ページの notFound 分岐・メタデータ）で実施（全 105 テストグリーン）。
> トップ/ヘッダーからの到達導線は未実装機能を出さない運用ルールに従い未追加（T06/T07/T10 で接続）。

### T06: 都道府県別地酒一覧

| 項目 | 内容 |
|---|---|
| 概要 | 都道府県の選択 UI から `/prefectures/[code]` の地酒一覧に到達し、カードから詳細へ遷移できる |
| 主な作業内容 | ① `src/lib/db/queries/sakes.ts` に県別一覧クエリ追加（蔵元 JOIN、ページネーション 24 件/頁）② `src/app/prefectures/[code]/page.tsx`（`revalidate = 3600`）③ 都道府県選択 UI（リスト形式。`src/lib/constants/prefectures.ts` 参照）をホームまたは同セグメント `_components/` に配置 ④ 不正コードは `not-found` |
| 受け入れ条件 | FR-07（選択 UI から一覧に到達） |
| 依存タスク | T05（sake-card・クエリ基盤）。T07 と並行可 |
| ブランチ | `feature/T06-prefecture-list` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜⑤完了。① `src/lib/db/queries/sakes.ts` に
> `selectSakesByPrefecture`（db 注入・テスト用）/`getSakesByPrefecture`（React.cache 公開）を追加し、
> 銘柄×蔵元 INNER JOIN を `breweries.prefecture_code` で絞って `SakeSummary[]` を名前→id の安定順で返す。
> 一覧カード用タグは `selectTagsBySakeIds` で銘柄 ID 配列から 1 クエリ一括取得してメモリで束ね、
> 銘柄数によらず計 2 クエリに抑える（N+1 回避）。② `src/app/prefectures/[code]/page.tsx` は
> RSC 直接クエリ・`revalidate=3600`・`generateMetadata` で「〇〇県の地酒」。JIS コード（01..47）以外は
> `findPrefectureByCode` の undefined 判定で `notFound()` に落とし DB へ問い合わせない。0 件は空状態メッセージ。
> ③ `src/app/prefectures/page.tsx` は `prefectures.ts` を単一情報源に `_lib/regions.ts`（地方 8 区分の純関数）で
> グルーピングした 47 都道府県リンク一覧（DB 非依存・静的配信）。④ 一覧は共有 `SakeCard` の初の実利用
> （非破壊で再利用。県名はカード内に出るが実害なく prop 追加はしない）。⑤ ヘッダーナビ「地酒を探す」＋
> ホームの導線ボタンを追加。テストは PGlite（県別絞り込み・タグ一括束ね・空状態・安定順）＋ SSR 出力検証
> （ページの notFound 分岐・空状態・メタデータ・選択 UI の全 47 リンク・地方グルーピング）で実施
> （全 122 テストグリーン。lint / typecheck / format:check / build 済み）。
> ブランチ名は指示に従い `feature/T06-prefecture-list`（TASKS 当初案 `feature/T06-prefectures` から変更）。
>
> レビュー対応（2026-07-04・4 ペルソナ Should 反映）: ①**ページネーション（24 件/頁）を実装**。
> `PAGE_SIZE=24` 定数（DESIGN §6.1）を定義し、`selectSakesByPrefecture(db, code, page)` に
> `limit/offset` と総件数 count クエリを追加、返り値を `{ sakes, total, page, pageSize }` に変更
> （`getSakesByPrefecture` の React.cache も page をキーに含める）。タグ一括取得はそのページ分の
> 銘柄 ID のみに渡すため計 3 クエリ（count + 一覧 + タグ）。ページは `_lib/pagination.ts` の純関数
> `parsePageParam`（0・負・非数・小数は 1 に丸め）/`totalPageCount`（切り上げ・0 件でも 1）で処理し、
> 総ページ数超過は最終ページへ `redirect`。UI に前へ/次へ・現在/総ページのページャ（1 頁に収まる県は非表示）、
> 「N 件」は総件数を表示。②**`generateStaticParams` を追加**して 47 コードをビルド時プリレンダ対象化
> （build で 5→52 静的生成。?page= の searchParams のため Route 判定上は ƒ だが 47 パスは事前生成＋ISR 併用。
> 完全静的化はパスセグメント化する将来の最適化余地としてコメント記載）。追加テスト: PGlite で 30 件投入の
> 2 頁分割・page=2 内容・範囲外・総件数、純関数のページ丸め、SSR でページャ表示/非表示・redirect・
> 静的パラメータ（全 136 テストグリーン）。

### T07: 検索機能

| 項目 | 内容 |
|---|---|
| 概要 | 名前（部分一致）× 都道府県 × 味タグの複合検索。URL クエリパラメータ駆動（決定 D7）で結果一覧→詳細へ遷移できる |
| 主な作業内容 | ① `src/app/search/_lib/build-search-query.ts`（URL パラメータ→検索条件の純関数、Zod で `SearchParams` に正規化）＋ `build-search-query.test.ts` ② `src/app/search/_lib/search-sakes.ts`（`name ILIKE` + `reading ILIKE`・蔵元 JOIN・タグ EXISTS の AND 結合、ページネーション）③ `src/app/search/page.tsx`（SSR）④ `src/app/search/_components/`（検索フォーム・結果一覧・**0件時の空状態＋条件緩和導線**）⑤ タグ一覧クエリ `src/lib/db/queries/tags.ts` |
| 受け入れ条件 | FR-06（全条件）、FR-02（タグをキーに絞り込める） |
| 依存タスク | T05。T06 と並行可 |
| ブランチ | `feature/T07-search` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜⑤完了。設計判断:
> - **味タグは AND 絞り込み**（「辛口かつ淡麗」で絞る）。タグごとに sake_tags×tags の EXISTS を
>   相関サブクエリで作り AND 連結（DESIGN §2.2 の複合絞り込み意図に沿う。OR より意図が明確）。
> - **都道府県は単一**（`prefectureCode?: string`）。複数県の要求がないため YAGNI。
> - **空条件時は全件を名前順で表示**（DESIGN §2.2 に既定なし。空状態で入力を促さず全件＋ページャに倒す）。
>   検索フォームは常に表示。`isEmptyCriteria` は履歴記録（T09）の「空検索は記録しない」判定にも再利用可。
> - **ページネーションは T06 の基盤を共有**。`_lib/pagination.ts` を `src/lib/pagination/pagination.ts`
>   へ責務名昇格し、県別一覧（T06）と検索（T07）の 2 機能で共有（機能固有 `_lib` 同士のパス依存を避ける。
>   DIRECTORY_STRUCTURE §5.3）。T06 側の import も更新済み。page 番号の正規化・上限（DoS 対策）も
>   `parsePageParam` に一本化。
> - **検索クエリ `searchSakes` は当初計画の `_lib/search-sakes.ts` を作らず `src/lib/db/queries/sakes.ts`
>   に集約**（`SakeSummary`・タグ一括取得を県別一覧と共有＝DIR-6 の横断クエリ判定。DESIGN §5.3・
>   DIRECTORY_STRUCTURE §2 ツリーも実配置に更新。CODE/PHIL レビュー指摘）。タグは `tagIds` でなく
>   `tagNames`（URL `?tags=` と DATABASE §2.7 filters に統一）、味タグは集合としてソート正規化（決定性）。
> - 実データ投入は Supabase 実プロジェクト作成後（T02 残作業）。ロジックは PGlite で検証済み。

### T08: 認証（サインアップ・ログイン・ログアウト）

| 項目 | 内容 |
|---|---|
| 概要 | Supabase Auth（メール＋パスワード）でサインアップ／ログイン／ログアウトでき、セッションが維持される |
| 主な作業内容 | ① `src/lib/auth/server.ts`・`client.ts`・`session.ts`（`@supabase/ssr` 標準パターン。supabase-js の型をここで閉じる）② `src/lib/auth/actions.ts`（signUp / signIn / signOut、Zod 入力検証）③ `src/app/login/page.tsx`・`src/app/signup/page.tsx`（`?next=` リダイレクト対応）④ `src/middleware.ts`（`updateSession`。`/history` ガードは T09 で有効化）⑤ `src/components/site-header.tsx` にログイン状態表示・ログアウト導線 |
| 受け入れ条件 | FR-04（サインアップ／ログイン／ログアウト） |
| 依存タスク | T02（profiles トリガ）、T01。T05〜T07 と並行可 |
| ブランチ | `feature/T08-auth` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜⑤完了。設計判断と実装内容:
> - **@supabase/ssr 標準パターン**: `src/lib/auth/` に境界を閉じ、`@supabase/*` import はここのみに限定
>   （DIRECTORY_STRUCTURE §5.2）。`server.ts`（RSC/Action 用 `createServerClient`＋`getCurrentUser`。
>   supabase-js の User 型を `AuthUser`= `{id, email}` に変換して外へ漏らさない）／`client.ts`
>   （`createBrowserClient`。今回は未使用だが標準パターンとして用意）／`session.ts`（middleware 用
>   `updateSession`）を分離。`env.ts` で公開接続情報を**遅延取得**し、環境変数未設定でも import・ビルドが
>   壊れないようにした（ランタイムで認証を使うと明確なエラー。閲覧・検索など匿名機能は動く）。
> - **middleware → proxy へ改名**: Next.js 16.2 が `middleware` を deprecated と警告するため、
>   `src/proxy.ts`（export `proxy`）に改名（DIRECTORY_STRUCTURE §2 注記の許容範囲）。matcher は
>   @supabase/ssr 公式推奨。`getUser()` で実トークン検証し、`getSession()`（Cookie 無検証）は使わない。
> - **ルート保護は /history のみ**（DESIGN §2.3）。指示スコープに従い**本タスクで有効化**（未ログインで
>   `/history` → `/login?next=/history`）。判定は純関数 `redirect.ts`（`isProtectedPath`・
>   `sanitizeRedirectPath`・`resolveAfterLogin`・`buildLoginRedirect`）に切り出し、境界一致で `/historyx`
>   を誤保護しないことも検証。他ページは未ログインでも閲覧可（Progressive Personalization）。
> - **オープンリダイレクト防止**（REVIEW T05 引き継ぎ・DESIGN §6.2）: `?next=` は自サイト内パスのみ許可
>   （先頭 `/`・`//` とプロトコル相対・バックスラッシュ・制御文字を弾く純関数）。Server Action の成功遷移・
>   ページの既ログイン遷移・フォームの hidden の 3 箇所すべてで検証（多層防御）。
> - **入力バリデーション**（`validation.ts`）: メール形式＋パスワード長（6..72）を Zod 純関数で検証。
>   エラー文言（`messages.ts`）はアカウント存在の推測を防ぐ汎用化（ログイン失敗はメール不存在と
>   パスワード誤りを区別しない）。ともにユニットテスト。
> - **ページ/ヘッダー**: `login`/`signup` は RSC で既ログインなら遷移、`AuthForm`（Client・useActionState）で
>   エラー表示。ヘッダーは async RSC 化し、ログイン状態で導線を出し分け（未: ログイン/新規登録、
>   済: 履歴＋ログアウト〔Server Action フォーム〕）。`/history` は保護枠のみ（中身は T09）。
> - パスワードのハッシュ化・セッション管理・CSRF は Supabase Auth／@supabase/ssr に委任（自前実装なし）。
>   認証 Cookie は @supabase/ssr が httpOnly で扱う。
> - テストは純関数（redirect 15・validation 7・messages 3）＋ SSR 出力/RTL（ヘッダー状態別・login/history の
>   リダイレクト分岐・AuthForm）で実施（全 215 テスト。lint/typecheck/format:check/build グリーン）。
> - T09 との整合: TASKS T09 ④「/history ガードを middleware で有効化」は本タスクで先行実装済み。
>   T09 では履歴記録 Server Action・`/history` の一覧クエリ（user_id はセッション強制）を実装する。
>
> **残作業（Supabase 実プロジェクト未作成のため持ち越し。実キーがないと疎通不可）**:
> 1. Supabase プロジェクト作成後、`.env.local` に `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY`
>    を設定（T02 残作業と同時）→ 実際のサインアップ／ログイン／ログアウト／セッション維持の疎通確認。
> 2. サインアップ時の `profiles` 自動作成トリガ（DATABASE §2.5）が効くことの実環境確認。
> 3. Supabase ダッシュボードでメール確認（Confirm email）設定の確認: 既定 ON だと signUp 直後は
>    未確認セッションになる可能性がある。PoC 段階では Confirm email を OFF にするか、確認メール導線を
>    追加するか運用判断が必要（本実装は signUp 成功で next へ遷移する前提。実環境で挙動確認）。
> 4. Supabase クライアントを直接叩く統合テスト（実キー前提）と E2E（サインアップ・ログイン）は T16 で実施。

### T09: 履歴記録と履歴画面

| 項目 | 内容 |
|---|---|
| 概要 | 詳細閲覧・検索実行を Server Action で記録し、本人だけが `/history` で参照できる |
| 主な作業内容 | ① `src/app/sake/[id]/_actions/record-view.ts`・`src/app/sake/[id]/_components/` に記録トリガ Client Component（マウント時 fire-and-forget、未ログインは no-op、失敗は表示に影響させない）② `src/app/search/_actions/record-search.ts`（`filters` jsonb に条件スナップショット。0 件検索も記録）③ `src/app/history/page.tsx`・`_lib/queries.ts`（**user_id を引数で受けず認証セッションから強制**＝主防御）④ `src/middleware.ts` の `/history` ガード（未ログイン→`/login?next=/history`） |
| 受け入れ条件 | FR-05（閲覧・検索が履歴として記録される）、FR-04（未ログインで履歴アクセス時に誘導） |
| 依存タスク | T05, T07, T08 |
| ブランチ | `feature/T09-history` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜⑤完了。設計判断と実装内容:
> - **fire-and-forget の記録**（DESIGN §2.4 / 決定 D3）: 詳細ページ・検索結果ページに小さな Client
>   Component（`_components/record-view-trigger.tsx`・`record-search-trigger.tsx`）を置き、実ブラウザの
>   マウント時に `useEffect` から Server Action（`record-view.ts`・`record-search.ts`）を `void`（await せず）
>   で呼ぶ。RSC レンダリング中に INSERT しないことでプリフェッチ・キャッシュ・ボットの多重記録を避け、実閲覧・
>   実検索のみを記録する。記録の失敗は表示に影響させない（Server Action 内で握るがログは必ず出す＝握りつぶし禁止
>   規約に反さない吸収）。
> - **多重記録の抑制**: DESIGN §2.4 は「追記専用で毎回記録してよい・避けるのはプリフェッチ多重のみ」。同一マウント内
>   の重複発火（React 18 StrictMode の二重マウント・同一値での再レンダリング）だけを `useRef` ガードで 1 回に抑える。
>   閲覧は `sakeId`、検索は「page を除いた条件のシリアライズ」をキーにし、条件が変われば再記録・ページ送りでは
>   再記録しない（ページ送りは同一検索の続き）。
> - **user_id 二段防御**（DESIGN §6.2 / DATABASE §4.1）: 主防御=公開関数（`getViewHistoryPage`・
>   `getSearchHistoryPage`・`recordView`・`recordSearch`）は **user_id を引数で受けず**必ず `getCurrentUser` で
>   セッションから取得。クライアントが渡せるのは sakeId / criteria のみで、他人の user_id で読み書きする経路が
>   UI に露出しない。下位の `selectViewHistory`/`selectSearchHistory` は db・userId を引数で受けてテスト可能に
>   するが、これらへ userId を渡すのは公開関数だけ。二段目=RLS（本人 SELECT・書き込みポリシーなしで anon 全拒否）。
> - **filters スナップショット**（DATABASE §2.7 / 決定 DB-5・DB-9 の CHECK と対応）: `q` は `query` カラム、
>   都道府県・タグは `filters`(jsonb) に `SearchCriteria` と同形で保存（`{"prefectureCode":"35","tagNames":["辛口"]}`）。
>   `page` は含めない（再検索は 1 ページ目から）。空条件（`isEmptyCriteria`）は記録しない（空検索=全件表示のため）。
>   0 件ヒットでも条件があれば記録する（「探したが無かった」も嗜好情報）。
> - **履歴クエリの配置**（DIR-3）: `/history` からしか使わない機能固有クエリのため `history/_lib/queries.ts` に置き、
>   横断カタログクエリ（`src/lib/db/queries`）へは昇格しない。銘柄要約は `SakeSummary`・`selectTagsBySakeIds`
>   （export 化）・`PAGE_SIZE` を再利用し、閲覧履歴は view_histories×sakes×breweries を JOIN・viewed_at DESC・
>   ページ分のタグを 1 クエリ一括取得（N+1 回避）。
> - **/history ページ**: T08 のプレースホルダを置換。閲覧履歴は `SakeCard`（詳細リンク）＋ JST 閲覧日時、検索履歴は
>   条件バッジ＋ `/search?...` 再検索リンク（`_lib/format.ts` の純関数 `searchHistoryToHref`/`Labels`/`formatViewedAt`）。
>   0 件は空状態＋検索導線。未ログインは middleware＋ページ側 `getCurrentUser` の多層防御で `/login?next=/history`。
> - **逸脱記録**（DIR-11・§5.2 例外）: 履歴 `_lib` から検索 `_lib`（`SearchCriteria`・`toSearchQueryString`・
>   `isEmptyCriteria`）を一方向参照。検索が URL⇔条件の唯一の情報源で再実装は二重定義になるため。循環なし。
>   3 機能目が現れたら責務名ディレクトリへ昇格する。DESIGN §5.3 の recordSearch シグネチャも実装（SearchCriteria）に更新。
> - テストは PGlite（履歴クエリ: 本人分のみ・他人の履歴が漏れない・時系列降順・JOIN／Server Action: 未ログイン no-op・
>   不正 id no-op・空条件スキップ・正常記録・user_id 強制・追記・失敗時ログのみ）＋純関数（format）＋ Client Component
>   （トリガの発火・多重抑制・fire-and-forget）＋ SSR 出力（/history の空状態・閲覧/検索履歴表示・未ログイン redirect）で
>   実施（全 251 テスト。lint / typecheck / format:check / build グリーン）。
> - **残作業**: 実際の認証済みユーザーでの記録・RLS 実効遮断は Supabase 実プロジェクトが要る（T02 残作業）。E2E は T16。

### T10: 履歴ベース推薦エンジン＋ホーム画面表示

| 項目 | 内容 |
|---|---|
| 概要 | ルールベース推薦エンジン（固定 IF・差し替え可能）を実装し、ホームに推薦カード列を表示する縦スライス |
| 主な作業内容 | ① `src/lib/recommend/types.ts`（`recommend(input)` の固定 IF・`RecommendedSake`/`RecommendReason`）② `src/lib/recommend/rule-based.ts`（直近履歴のタグ＋都道府県〔擬似タグ〕頻度を時間減衰つきで集計する単一 SQL → 未閲覧銘柄をタグ一致度でスコアリング）③ `src/lib/recommend/scoring.ts`（スコア計算の純関数、重み定数を注入可能に）＋ `scoring.test.ts` ④ コールドスタート: 履歴 3 件未満・未ログインは `popularity_rank` 上位＋ランダム性のフォールバック（reason: "人気の銘柄"）⑤ `src/lib/recommend/index.ts`（実装の選択）⑥ `src/app/page.tsx`・`_components/` で推薦カード列＋ reason 表示。未ログイン時はログイン誘導を併記 |
| 受け入れ条件 | FR-05（ホームに履歴ベースのおすすめ表示＋フォールバック） |
| 依存タスク | T09（履歴データ）、T05（sake-card） |
| ブランチ | `feature/T10-recommend`（指示に従い当初案 `feature/T10-recommend-home` から変更） |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜⑥完了。設計判断と実装内容:
> - **固定インターフェース（差し替え可能な知能。PLAN_PHILOSOPHY 原則3 / DESIGN §2.5）**:
>   `src/lib/recommend/types.ts` に `recommend({ userId, limit }): Promise<RecommendedSake[]>` の契約
>   （`RecommendedSake = { sake: SakeSummary; reason: RecommendReason }`）を定義。実装の選択は
>   `index.ts` の 1 箇所だけが行い、現在は `rule-based.ts`（タグ頻度＋時間減衰）へ委譲する。将来
>   協調フィルタリング等へ差し替える際は同ディレクトリに別ファイルを足し index.ts の委譲先を変える
>   だけで、呼び出し側（`src/app/page.tsx`）は無変更（DIRECTORY_STRUCTURE 例2 が実際に成立）。
> - **スコアリングの純関数分離（TEST_PHILOSOPHY）**: `scoring.ts` に (a) 履歴イベント→嗜好プロファイル
>   （時間減衰つき頻度集計 `buildPreferenceProfile`）(b) プロファイル＋候補→スコア（`scoreCandidates`）を
>   DB 非依存の純関数として切り出し、`rule-based.ts`（DB アクセス）と分離。重み・減衰は `ScoringWeights`
>   定数（`DEFAULT_WEIGHTS`）に集約し関数引数で注入可能（マジックナンバー禁止。CODING_PHILOSOPHY）。
> - **時間減衰は指数（半減期方式）**: `timeDecay = 0.5^(ageDays/halfLifeDays)`（既定 halfLifeDays=14）。
>   線形（打ち切り式）は打ち切り日以前が一律 0 になり嗜好が階段状に飛ぶため、直近を強く反映しつつ古い
>   履歴も緩やかに残す指数を採用。閲覧 1.0 / 検索 0.7（検索は AND 複数タグで過大評価しやすいためやや軽く）、
>   都道府県は擬似タグ倍率 0.6（産地だけで埋まらないよう味タグより弱める。DESIGN §3・D2 の擬似タグ扱いを
>   ロジック側に閉じる）。初期値は DESIGN §9 の「実装時に定数化し調整」に沿う暫定値。
> - **閲覧済み銘柄は「除外」（減点でなく）**: ホームは新規発見の面であり既視銘柄の再提示は価値が薄い。
>   閲覧履歴自体は /history で参照できる。`scoreCandidates` が viewedSakeIds を除外し、候補取得 SQL でも
>   `not in` で先に外す（メモリに載せる候補集合を小さく保つ）。スコア 0（一致なし）も落とす。
> - **コールドスタート条件＝「未ログイン or 履歴イベント総数 < しきい値(3)」**: 未ログイン（userId=null）と
>   履歴 3 件未満を同じフォールバック（`popularity_rank` 上位を Fisher-Yates でシャッフルし limit 件）に
>   落とす（reason: popular=「人気の銘柄」。DESIGN §2.5・§4.2）。popularity_rank が NULL の銘柄は母集団に
>   入れない（index 3 の部分インデックス対象）。履歴ベースでスコア上位が limit に満たない場合も人気銘柄で
>   補完し、ホームを常に埋める。
> - **嗜好プロファイルの表現**: `{ tags: Map<name, weight>; prefectures: Map<code, weight> }`。都道府県は
>   正規化を保ったまま（テーブル化しない D2）ロジック側で擬似タグとしてタグ空間に混ぜる。検索履歴の
>   filters(jsonb) は DB を信頼せず `readFilterSignals` で防御的に読む（unknown ガード。REVIEW T09 の姿勢を踏襲）。
> - **横断配置（DIRECTORY_STRUCTURE DIR-6・§5.1）**: 推薦は複数画面・将来のチャット（T14）からも使う横断
>   ロジックのため `src/lib/recommend/` に置く。既存資産を再利用（重複実装なし）: `SakeSummary`・
>   `selectTagsBySakeIds`（タグ N+1 回避の一括取得）・`CatalogDb`（PGlite 差し込み型）・`SakeCard`・
>   `getCurrentUser`（React.cache 済み）・`findPrefectureByCode`。推薦理由の文言化は `app/_lib/
>   recommend-reason-label.ts`（ホーム専用の純関数）に分離し、RecommendReason の構造だけを UI が知る。
> - **ホーム画面（`src/app/page.tsx` のプレースホルダを置換）**: `getCurrentUser` の有無で `recommend` に
>   userId を渡し分け、見出しを「あなたへのおすすめ」/「人気の日本酒」で出し分け。未ログインには
>   ログイン/新規登録の誘導を併記（思想: 認証を機能のゲートにしない。DESIGN §2.3・PLAN_PHILOSOPHY 原則5）。
>   各カードに reason を軽く添える（推薦の透明性。DESIGN §4.2）。ユーザー依存のため `dynamic=force-dynamic`。
> - テストは純関数（scoring: 時間減衰・嗜好集計・スコアリング・閲覧済み除外・重み注入／reason-label 文言）＋
>   統合（PGlite: 履歴ありユーザーは嗜好一致銘柄が上位・閲覧済み除外・人気補完・limit 遵守／コールドスタートは
>   人気順・未ログイン・履歴しきい値未満・limit 0）＋ SSR 出力（ログイン/未ログインで見出し・内容・ログイン誘導が
>   変わる。getCurrentUser・recommend をモック）で実施（全 282 テスト。lint / typecheck / format:check / build
>   グリーン。T09 の 254 から +28）。
> - **残作業**: 実際の認証済みユーザーでの推薦（実履歴データ）は Supabase 実プロジェクトが要る（T02 残作業）。
>   ロジックは PGlite＋モックで検証済み。E2E は T16。重み・減衰の実データでのチューニングは稼働後（DESIGN §9）。
>
> レビュー対応（2026-07-04・4 ペルソナ Should/Consider 反映）:
> - **候補母集団の上限（PERF/SEC S-1）**: `RuleBasedConfig` に `candidatePoolSize`(200)・`maxProfileTags`(30) を
>   追加。候補取得 SQL を人気順（`popularity_rank asc nulls last` → id）で上位 candidatePoolSize 件に切ってから
>   メモリでスコアリングし、汎用タグ持ちヘビーユーザーでの自己 DoS を防ぐ。プロファイルは
>   `truncateProfileTags`（scoring.ts の純関数）で重み上位 K 件に絞ってから IN に渡す。
> - **全期間の既視除外（CODE S-1）**: 嗜好集計用の履歴取得（`collectHistory`・直近 recentHistoryLimit 件）と、
>   除外用の閲覧済み ID 集合（`selectViewedSakeIds`・全期間 distinct・`excludeIdCap`(5000) 上限）を分離。100 件超の
>   ユーザーでも既視銘柄が推薦に混入しない（「ホームは新規発見」の不変条件を全期間で担保）。
> - **フォールバックの件数充足（CODE S-2）**: `selectPopular` の母集団取得を `limit(max(poolSize, limit))` にし、
>   limit > poolSize でも件数不足にならない不変条件を保証。
> - **単一 SQL 記述の乖離解消（PHIL S-1）**: DESIGN §2.5/§4.2 を「複数クエリ（履歴集計・候補絞り込み・タグ一括・
>   人気補完）＋スコア計算の純関数」に更新（selectTagsBySakeIds 再利用・候補 SQL 事前絞りのため分割）。
> - **ホーム見出しの実態整合（PHIL S-2）**: ログイン済みでも中身が全て popular（履歴しきい値未満）なら見出しを
>   「人気の日本酒」に倒す（`recommendations.some(reason.kind==="history")` で判定）。
> - **Consider**: 公開 IF `recommend()` で limit を `min(max(0,limit), 50)` にクランプ（SEC C-1）。コールドスタート
>   （`fallbackOnly`）にも閲覧済み ID を渡して既視除外（CODE C-1）。
> - 追加テスト: `truncateProfileTags` 純関数、候補上限で母集団が切られる・全期間の既視除外（直近取得上限超）・
>   limit>poolSize の件数充足の PGlite 回帰（全 290 テスト。lint / typecheck / format:check / build グリーン）。

### T11: 埋め込みパイプライン

| 項目 | 内容 |
|---|---|
| 概要 | 説明文の埋め込みを差分生成して `sake_embeddings` に upsert する（RAG の知識源整備） |
| 主な作業内容 | ① `src/lib/ai/models.ts`（AI Gateway 経由のモデル ID 定数）・`src/lib/ai/embedding.ts`（`embedText(text)`。Web とバッチで共用、AI SDK の import はここに集約）② `scripts/embed.ts`（description の SHA-256 を `source_hash` と比較し**変更行のみ再埋め込み**、`model` 列で差し替え時の再生成判定）③ `package.json` に `embed` script ④ 差分判定ロジックのユニットテスト |
| 受け入れ条件 | FR-08 の基盤（知識源の埋め込み） |
| 依存タスク | T04（説明文）。T05〜T10 と並行可 |
| ブランチ | `feature/T11-embedding-pipeline` |
| 状態 | 完了 |

> 実施メモ（2026-07-04）: ①〜⑤完了。設計判断と実装内容:
> - **AI SDK v6（Gateway 経由）**: `ai@^6.0.219`（TECH_STACK §5 の 6 系採用・v7 見送りに準拠）を
>   依存に追加。`src/lib/ai/embedding.ts` に AI SDK の import を閉じ込め（DIRECTORY_STRUCTURE §5.2:
>   AI SDK の import は lib/ai と api/chat のみ許可）、`embed`/`embedMany` を `gateway.textEmbeddingModel`
>   に渡して呼ぶ。モデル ID は `src/lib/ai/models.ts` の定数 `EMBEDDING_MODEL_ID="openai/text-embedding-3-small"`・
>   `EMBEDDING_DIMENSIONS=1536`（差し替えはこの 1 箇所。DIRECTORY_STRUCTURE §5.1）。
> - **埋め込み対象テキストの構成**（`buildEmbeddingText` 純関数）: 「銘柄名＋蔵元＋都道府県名＋説明文＋タグ」を
>   ラベル付き（`銘柄: / 蔵元: / 都道府県: / 説明: / タグ:`）の日本語 1 テキストに組み立てる。都道府県は
>   `findPrefectureByCode`（既存定数を再利用）でコード→県名に解決し、未解決・タグなしは行ごと省く。タグは
>   決定性のため名前順ソート（並び替えでハッシュがブレない）。DB スキーマ非依存の入力型 `EmbeddingSource` にし、
>   `scripts/embed.ts` が銘柄行から詰める。
> - **sourceHash アルゴリズム＝SHA-256(hex)**（`computeSourceHash` 純関数。DATABASE.md §2.10 が SHA-256 hex と規定）:
>   埋め込みテキスト全体をハッシュ。説明文だけでなくタグ・蔵元・都道府県の変化も検知する（テキストが変われば
>   再埋め込みされる）。DESIGN §2.7「説明文のハッシュ」を、埋め込み対象テキスト＝差分基準に統一した。
> - **差分埋め込み**（`selectWorkItems` 純関数＋`embedSakes`）: description 非空の銘柄を候補にし、既存
>   `sake_embeddings`（sakeId→{sourceHash, model}）と突き合わせ、**未登録・source_hash 変化・model 変化**の
>   いずれかに該当する銘柄だけ埋め込み生成→`sake_id` 競合キーで冪等 upsert（`model` 列に使用モデルを記録）。
>   差分なしは API を一切叩かない（DESIGN §6.3 のコスト最小化）。既存 `seed.ts`/`import-sakenowa.ts` の
>   chunk・isDirectRun・closeDb（try/finally）パターンと `selectTagsBySakeIds`（タグ一括取得・N+1 回避）を再利用。
> - **キー未設定時の挙動**: `AI_GATEWAY_API_KEY` は gateway プロバイダが実行時に参照するため import・build 時は
>   不要（未設定でもモジュール読込・ビルドは壊れない＝閲覧/検索など匿名機能に影響しない）。`npm run embed` の
>   main は埋め込み生成前にキーの有無を明示チェックし、未設定なら DB を叩く前に明確なエラーで停止する
>   （握りつぶさない）。`.env.example` に用途・取得手順を追記。
> - **注入可能性（TEST_PHILOSOPHY: 実 API を叩かない）**: `embedSakes(db, embed, model)` は埋め込み関数
>   （`EmbedTextsFn`）を注入口にし、本番は `embedTexts`（実 API）、テストは決定的なフェイクベクトル（1536次元）を
>   渡す。実 API 呼び出し部分はテストで一切実行しない。
> - テストは純関数（テキスト組み立て: 5 要素の包含・決定性・タグ順不同同一・タグ/都道府県省略／sourceHash:
>   hex 形式・同一入力同一・説明文/タグ変化検知）＋差分判定（未登録・差分なし・hash 変化・model 変化）＋
>   PGlite 統合（初回全件・説明文なし除外・2 回目差分ゼロ・変更行のみ再埋め込みと hash 更新・model 差替で全件・
>   タグ変化・1536次元格納。フェイク埋め込み注入）で実施（全 309 テスト。lint/typecheck/format:check/build グリーン。
>   T10 の 290 から +19）。
> - **残作業**: 実 API 疎通（AI Gateway で text-embedding-3-small を実際に叩く）は `AI_GATEWAY_API_KEY` 実キーと
>   Supabase 実 DB（T02 残作業の投入済みデータ）が要る。手順: `.env.local` に `AI_GATEWAY_API_KEY` を設定 →
>   `npm run seed` で説明文投入 → `npm run embed` で埋め込み生成。日本語埋め込み精度の検証（FEASIBILITY R3/R4）と
>   retriever 重みの確定は **T13 の PoC** で実施する（本タスクはパイプラインの整備まで）。

### T12: RAG リトリーバ＋捏造防止検証

| 項目 | 内容 |
|---|---|
| 概要 | LLM 非依存のハイブリッド検索（SQL 絞り込み＋ pgvector 類似度）と、提案 ID の DB 存在検証を実装する |
| 主な作業内容 | ① `src/lib/rag/retriever.ts`（`retrieveSakeCandidates()`: タグ・都道府県・価格帯の SQL 絞り込み＋ `<=>` コサイン類似度。必ず実在 sakeId を含む候補を返す、候補上限は定数〔初期 8 件〕）② `retriever.test.ts`（テスト DB での統合テスト）③ `src/lib/rag/validate-proposed.ts`（`validateProposedSakeIds()`: 実在 ID のみ返す）＋ `validate-proposed.test.ts` |
| 受け入れ条件 | FR-08（提案は DB 実在の銘柄のみ＝捏造防止の一段目・二段目の部品） |
| 依存タスク | T11 |
| ブランチ | `feature/T12-rag-retriever` |
| 状態 | 未着手 |

### T13: RAG 精度 PoC（FEASIBILITY R3/R4）

| 項目 | 内容 |
|---|---|
| 概要 | 銘柄 50 件×質問 10 パターンで「埋め込み検索の精度」と「ヒアリング→検索条件変換の品質」「structured output＋ID 検証による捏造防止」を検証し、retriever の重み・プロンプト方針を確定する |
| 主な作業内容 | ① 質問 10 パターンと期待銘柄の評価セット作成 ② retriever 単体の精度計測（意図した銘柄が上位に来るか）③ Claude Haiku 4.5 ＋ `searchSake`/`proposeSake` ツール案でヒアリング→条件変換→提案の 1 往復を試行し、捏造が ID 検証で落ちることを確認 ④ 結果と調整（retriever の重み・`src/lib/ai/prompts.ts` の初版システムプロンプト）を `docs/FEASIBILITY.md` 追記または `docs/` 配下の PoC 記録として残す ⑤ 検証スクリプトは使い捨てとし `main` のビルド対象に含めない |
| 受け入れ条件 | FR-08（品質リスク R3/R4 の解消。受け入れ条件を満たせる見込みの確定） |
| 依存タスク | T12 |
| ブランチ | `feature/T13-rag-poc` |
| 状態 | 未着手 |

### T14: RAG チャットボット（UI＋API）

| 項目 | 内容 |
|---|---|
| 概要 | `/chat` の Q&A ヒアリング→複数銘柄提案の縦スライス。ストリーミング応答と検証済みカード表示 |
| 主な作業内容 | ① `src/app/api/chat/route.ts`（唯一の Route Handler。Zod 入力検証→`streamText`〔AI Gateway 経由 Claude Haiku 4.5〕→`proposeSake` の ID を **DB 存在検証してからデータパートで送信**。実在しない ID は黙って除外）② `src/app/api/chat/_lib/tools.ts`（`searchSake`: retriever 呼び出し／`proposeSake`: Zod structured output）③ `src/lib/ai/prompts.ts`（T13 で確定したシステムプロンプト: ヒアリング 2〜3 問→検索→提案、検索結果内の銘柄のみ提案）④ `src/app/chat/page.tsx`・`_components/`（`useChat` ストリーミング表示・提案カード〔`/sake/[id]` リンク付き、sake-card 共用〕・LLM 応答はプレーンテキスト表示）⑤ generator のユニットテストは `src/lib/ai` アダプタの固定応答モックで（実 API は叩かない） |
| 受け入れ条件 | FR-08（チャットで質問→回答→複数提案、提案は実在銘柄＋詳細リンク、捏造しない） |
| 依存タスク | T12, T13 |
| ブランチ | `feature/T14-chat` |
| 状態 | 未着手 |

### T15: チャット運用ガード（コスト上限・フォールバック・セッション保存）

| 項目 | 内容 |
|---|---|
| 概要 | チャットのコスト・障害・永続化の運用面を仕上げる（DESIGN §6.3・§6.4・決定 D4） |
| 主な作業内容 | ① コスト上限ガード: 往復数上限（初期 10）・メッセージ長上限・`maxOutputTokens` を定数化、超過時は検索ページ誘導を返す ② ログインユーザーのレート制限（DB カウントで 20 会話/日。`chat_sessions` の index 8 を利用）③ LLM 障害時フォールバック: タイムアウト（30 秒）→エラーパート→UI で「混み合っています」＋ヒアリング内容から組み立てた検索 URL 導線 ④ ログインユーザーの確定提案のみ `chat_sessions`/`chat_messages` へ保存（`proposed_sake_ids` は検証済み ID のみ、匿名は保存しない） |
| 受け入れ条件 | FR-08（安定運用）、非機能（コスト・可用性） |
| 依存タスク | T14, T08 |
| ブランチ | `feature/T15-chat-guards` |
| 状態 | 未着手 |

### T16: E2E テスト整備（主要 3 導線）

| 項目 | 内容 |
|---|---|
| 概要 | 主要導線の Playwright E2E を整備し、CI に組み込む（TEST_PHILOSOPHY: E2E は 3 導線のみ） |
| 主な作業内容 | ① `e2e/search-flow.spec.ts`（検索→一覧→詳細）② `e2e/auth.spec.ts`（サインアップ・ログイン）③ `e2e/chat.spec.ts`（チャット 1 往復。LLM はモックエンドポイント）④ `.github/workflows/ci.yml` に Playwright ジョブ追加 |
| 受け入れ条件 | FR-04 / FR-06 / FR-08 の導線の回帰保証（横断） |
| 依存タスク | T07, T08, T14 |
| ブランチ | `feature/T16-e2e` |
| 状態 | 未着手 |

---

## 2. 実装順序と依存グラフ

各タスクのマージ時点で `main` が起動可能・テストグリーンに保てる順序。

```mermaid
graph LR
    T01[T01 初期化] --> T02[T02 DB基盤]
    T02 --> T03[T03 さけのわ取込]
    T02 --> T04[T04 シード]
    T02 --> T08[T08 認証]
    T03 --> T05[T05 詳細ページ]
    T04 --> T05
    T05 --> T06[T06 県別一覧]
    T05 --> T07[T07 検索]
    T05 --> T09
    T07 --> T09[T09 履歴]
    T08 --> T09
    T09 --> T10[T10 推薦+ホーム]
    T04 --> T11[T11 埋め込み]
    T11 --> T12[T12 リトリーバ]
    T12 --> T13[T13 RAG PoC]
    T13 --> T14[T14 チャット]
    T14 --> T15[T15 チャットガード]
    T08 --> T15
    T07 --> T16[T16 E2E]
    T08 --> T16
    T14 --> T16
```

**直列の基本順**: T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11 → T12 → T13 → T14 → T15 → T16

**並行可能な組**（1人開発でも PR を分けたまま前後入れ替え可）:

- T03 ∥ T04（ともに T02 のみに依存。書き込みキーが別）
- T06 ∥ T07（ともに T05 のみに依存）
- T08 は T05〜T07 と並行可（T02 完了後いつでも）
- T11 → T12 の列は T04 完了後、T05〜T10 と並行可

データインポート（T03・T04）を最前段に置くのは「データが無いと画面が作れない」ため。
T05 以降の画面タスクは常に実データで動作確認できる。

---

## 3. 受け入れ条件カバレッジ対応表

REQUIREMENTS.md の全受け入れ条件がいずれかのタスクでカバーされることの確認。

| FR | 受け入れ条件 | 担当タスク |
|---|---|---|
| FR-01 | 日本酒データが DB に格納され、一覧・詳細（サーバ側データ取得＋ページ、DESIGN §5.1 の解釈）で取得できる | T02（スキーマ）＋ T03/T04（投入）＋ T05（詳細）＋ T06/T07（一覧） |
| FR-01 | データ投入（シード/インポート）が再実行可能な手順として整備されている | T03（冪等 upsert＋npm script）＋ T04（同） |
| FR-02 | 日本酒詳細でタグ一覧が表示される | T05 |
| FR-02 | タグをキーに日本酒を絞り込める | T07（タグ条件検索）※タグ付与自体は T03/T04 |
| FR-03 | `/sake/[id]` 形式の URL で詳細ページへ直接アクセスできる | T05 |
| FR-03 | 外部リンクは別タブで開き、リンクが無い場合は非表示になる | T05 |
| FR-04 | メール等でサインアップ／ログイン／ログアウトできる | T08 |
| FR-04 | 未ログインで履歴・パーソナライズ推薦にアクセスすると誘導される | T09（/history ガード）＋ T10（ホーム推薦枠のログイン誘導） |
| FR-05 | 詳細ページ閲覧と検索実行が履歴として記録される | T09 |
| FR-05 | ホーム画面に履歴に基づくおすすめが表示される（無履歴時はフォールバック） | T10 |
| FR-06 | 名前・都道府県・味の各条件および組み合わせで検索できる | T07 |
| FR-06 | 結果一覧のカードから詳細ページに遷移できる | T07（＋ T05 の sake-card） |
| FR-06 | 該当 0 件の場合は空状態メッセージが表示される | T07 |
| FR-07 | 都道府県の選択 UI（マップまたはリスト）から一覧に到達できる | T06 |
| FR-08 | チャット UI で質問→回答のやり取りができ、最終的に日本酒が複数提案される | T14（品質担保: T13、基盤: T11/T12、安定運用: T15） |
| FR-08 | 提案はアプリ内 DB に存在する日本酒であり、詳細ページへのリンクを持つ | T12（ID 検証部品）＋ T14（サーバ側検証＋カードリンク） |
| FR-08 | DB に無い銘柄を捏造して提案しない（RAG の検索結果に基づく） | T12＋T13（PoC で確認）＋T14（二段構えの実装） |

取りこぼし・どの受け入れ条件にも紐づかないタスクなし（T01・T02・T16 は全 FR の土台／回帰保証、
T11 は FR-08 の基盤として明示的に紐づく）。

---

## 4. 分解上の判断（自律実行モードでの決定と理由）

| # | 判断 | 理由 |
|---|---|---|
| TK-1 | プロジェクト初期化（T01）と DB 基盤（T02）を分離 | scaffold＋CI と Supabase＋10テーブルはそれぞれ単体でレビュー可能な PR サイズであり、1 つに詰めると粒度過大。T01 マージ時点で `main` は空アプリとして起動可能 |
| TK-2 | データインポートを T03（さけのわ）と T04（シード）に分割 | データソース 1 つ＝スクリプト 1 本＋`scripts/lib/<source>/`（DIRECTORY_STRUCTURE 例4 と同型）。冪等 upsert キーも別で、独立に検証できる。画面より先に置き、以降の全画面タスクを実データで確認可能にする |
| TK-3 | RAG を T11（埋め込み）／T12（リトリーバ）／T13（PoC）／T14（チャットUI＋API）／T15（運用ガード）に分割 | DESIGN §2.6 の retriever/generator 分離をそのままタスク境界にした。T12 は LLM 非依存で単体マージ可能。PoC（FEASIBILITY R3/R4 推奨）は retriever 完成後・チャット実装前に置き、プロンプト・重みを確定してから T14 に入る。T15（レート制限・フォールバック・保存）を分けたのは、T14 だけで FR-08 の受け入れ条件を満たし `main` が壊れないため |
| TK-4 | 履歴ベース推薦は T10 で「エンジン＋ホーム表示」の 1 縦スライス | エンジン単体では画面価値がなく、ホーム表示単体ではロジックがない。固定 IF（`src/lib/recommend/types.ts`）〜カード表示までで FR-05 後半の受け入れ条件を 1 PR で満たす |
| TK-5 | 履歴記録と履歴画面を T09 で 1 タスクに | 記録（Server Actions）だけでは受け入れ確認手段がなく、画面（/history）だけでは表示対象がない。記録→参照で 1 つの完結した機能パス |
| TK-6 | E2E を T16 として最後に分離 | E2E は機能横断で単一の持ち主がいない（DIRECTORY_STRUCTURE 決定 DIR-5）。3 導線（検索・認証・チャット）が全部揃う T14 以降でのみ書ける |
| TK-7 | T13 PoC の成果物はドキュメント＋定数調整のみ | PoC スクリプトを `main` の恒久コードにしない（使い捨てスパイク）。確定した知見はプロンプト定数・retriever 重み・docs への追記として残す |
