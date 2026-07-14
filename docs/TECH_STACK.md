# 技術選定書（TECH_STACK）— Jizake（日本酒レコメンドWebアプリ）

> 選定日: 2026-07-04
> 入力: `docs/REQUIREMENTS.md`（FR-01〜FR-08）／`docs/philosophy/PLAN_PHILOSOPHY.md`／`docs/FEASIBILITY.md`
> 前提: グリーンフィールド・個人開発・Windows 開発環境・無料枠〜低コスト志向。
> 自律実行モードのため、判断が必要な点は推奨デフォルトを採用し、理由を本書に明記した。

## 0. 評価軸と重み（思想との対応）

PLAN_PHILOSOPHY のコア原則を評価軸の重みに変換した。

| 評価軸 | 重み | 由来する思想 |
|---|---|---|
| シンプルさ（学習コスト・構成要素の少なさ） | 最重 | 原則1: シンプルさ最優先 |
| マネージド度・運用負荷ゼロ | 重 | 原則4: マネージド優先・運用ゼロ志向 |
| 無料枠〜低コスト | 重 | 非機能要件（コスト）・原則4 |
| 差し替え可能性（LLM/埋め込み/推薦の交換容易性） | 重 | 原則3: 差し替え可能な知能 |
| エコシステム成熟度・情報量 | 中 | 個人開発での自走可能性 |
| 性能（検索2秒以内・チャットストリーミング） | 中 | 非機能要件（性能） |
| 新しさ・人気 | 低 | 流行を理由に選ばない |

横断ルール: 外部サービス（LLM・認証・データソース）はアダプタ越しに使い、ベンダー型をドメイン層に漏らさない（思想「境界と依存方向」）。

## 1. 採用スタック一覧（サマリ）

| 領域 | 採用 | バージョン目安（2026-07 時点） |
|---|---|---|
| 言語 | TypeScript | 5.x |
| フレームワーク | Next.js（App Router） | 16.2.x（安定版） |
| DB / ベクタ | Supabase Postgres + pgvector | マネージド（無料枠） |
| ORM / マイグレーション | Drizzle ORM + drizzle-kit | 最新安定版 |
| 認証 | Supabase Auth（@supabase/ssr） | マネージド |
| AI フレームワーク | Vercel AI SDK | 6.x（v7 は様子見、§5 参照） |
| LLM ルーティング | Vercel AI Gateway | マネージド（$5/月 無料クレジット） |
| LLM | Claude Haiku 4.5（Sonnet へ切替可能に抽象化） | API |
| 埋め込み | OpenAI text-embedding-3-small（1536次元） | API |
| 検索 | Postgres ILIKE + タグ JOIN（将来 pg_trgm） | DB 内蔵 |
| UI | Tailwind CSS v4 + shadcn/ui | Tailwind 4.x |
| ホスティング | Vercel（Hobby） | マネージド |
| 単体・結合テスト | Vitest | 4.x |
| E2E テスト | Playwright | 最新安定版 |
| CI | GitHub Actions | — |
| データ取得バッチ | ローカル Node スクリプト（tsx）＋シードファイル | — |

---

## 2. 言語・フレームワーク

### 採用: TypeScript + Next.js 16（App Router）

**選定理由（思想対応）**

- **シンプルさ最優先**: 1 つのフレームワークで SSR・API ルート（Route Handlers）・ストリーミングまで完結し、フロント/バック分離構成（例: SPA + 別 API サーバー）より構成要素が少ない。
- **マネージド優先**: Vercel へのゼロコンフィグデプロイが可能で、インフラ設定を書かない。
- **差し替え可能な知能**: RAG チャットの中核となる Vercel AI SDK（`useChat`、ストリーミング、tool calling）が React / Next.js を第一級サポートしており、FR-08 の実装コストが最小。
- 2026-07 時点の安定版は 16.2.x（16 系は 2025-10 リリース、Turbopack デフォルト・React 19.2）。メジャー直後ではなく枯れており採用リスクが低い。

**類似技術との比較と不採用理由**

| 候補 | 評価 | 不採用理由 |
|---|---|---|
| **Next.js App Router（採用）** | AI SDK・Vercel・shadcn/ui との親和性最高。情報量最大 | — |
| Remix（React Router 7） | データロード設計は優れる | Remix は React Router 7 への統合で位置づけが流動的（フレームワークとしての将来像が過渡期）。AI SDK の UI フック・RAG テンプレートは Next.js 前提のものが最多で、個人開発で情報を探すコストが高い |
| SvelteKit | ランタイムが軽くシンプル | UI 層で採用する shadcn/ui（React 版が本家）や AI SDK の React 向け機能・作例が使えない/少ない。チーム（=本人）の React 資産と乖離 |
| Nuxt（Vue） | フルスタック機能は同等 | 同上。React エコシステム（shadcn/ui・AI SDK テンプレート）から外れる合理的理由がない |

出典: [Next.js 16 リリース](https://nextjs.org/blog/next-16)、[Next.js 16.2](https://nextjs.org/blog/next-16-2)

---

## 3. DB・ORM

### 採用: Supabase Postgres + pgvector ／ ORM は Drizzle

**選定理由（思想対応）**

- **データ中心設計**: Sake / Tag / History のリレーショナルスキーマと RAG 用ベクタを**同一の Postgres** に置ける。検索・推薦・RAG が「同じ日本酒データを異なる方法で引く」という思想と完全に一致し、ベクタ DB を別サービスにする必要がない。
- **マネージド優先・低コスト**: pgvector は Supabase 全プラン（無料含む）で追加費用なし。3,000 件 × 1536 次元 ≒ 20MB で無料枠 500MB に余裕（FEASIBILITY §3.1 で裏取り済み）。
- **シンプルさ**: DB・ベクタ・認証が 1 サービスに集約され、管理画面も 1 つ。
- **ORM に Drizzle**: SQL に近い薄い API で、推薦ロジック（タグ頻度の集計 JOIN）のような集計 SQL を素直に書ける。バンドル約 57KB とサーバレスで軽量（Prisma 7 の約 1.6MB に対し約 28 分の 1）。マイグレーション（drizzle-kit）とシードスクリプトの再実行可能性（FR-01 受け入れ条件）を満たす。

**類似技術との比較と不採用理由**

| 候補 | 評価 | 不採用理由 |
|---|---|---|
| **Drizzle（採用）** | SQL に近い・軽量・pgvector 型サポート | — |
| Prisma | スキーマ DSL が学びやすく、Prisma 7（2025-11）で WASM 化しバンドル 14MB→1.6MB に改善 | 改善後も Drizzle 比で重く、抽象度が高い分「推薦スコアの集計 SQL」のような生 SQL 寄りの処理で回り道になる。本件は SQL を直接書ける方がシンプル（原則1） |
| Supabase client 直（supabase-js のみ） | 最少依存 | マイグレーション・シードのコード管理（FR-01「再実行可能な手順」）と複雑な集計 JOIN（FR-05 推薦）に不向き。クエリの型安全性が弱い |
| 専用ベクタ DB（Pinecone 等） | 大規模ベクタ検索に強い | 数千件規模ではオーバーキル。サービスが 1 つ増え、リレーショナルデータとの JOIN ができず思想（データ中心）に反する |

**注意（RLS との関係）**: Drizzle でのサーバ接続（コネクションプーラ経由）は RLS を素通しできるため、履歴の本人限定参照は「サーバ側で必ず user_id フィルタを適用」＋「RLS を defense-in-depth として有効化」の二段構えとする（詳細は DESIGN で規定）。

出典: [Supabase pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)、[Drizzle vs Prisma 2026（makerkit）](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma)、[Drizzle vs Prisma（encore.dev）](https://encore.dev/articles/drizzle-vs-prisma)、[Prisma 公式比較](https://www.prisma.io/docs/orm/more/comparisons/prisma-and-drizzle)

---

## 4. 認証

### 採用: Supabase Auth（@supabase/ssr で Next.js 統合）

**選定理由（思想対応）**

- **マネージド優先**: パスワードハッシュ化・セッション管理をマネージド側が担保（非機能要件のセキュリティ）。
- **シンプルさ**: DB と同一基盤のためサービスが増えない。ユーザー ID がそのまま DB の外部キーになり、履歴テーブル（FR-05）との結合が最短。
- **低コスト**: 無料枠 50,000 MAU は個人開発規模で事実上無制限（FEASIBILITY §4 で裏取り済み）。
- **未ログインでも価値がある（原則5）**: 閲覧・検索・チャットは匿名で動かし、履歴・推薦のみ認証ゲートにする構成が素直に組める。

**類似技術との比較と不採用理由**

| 候補 | 評価 | 不採用理由 |
|---|---|---|
| **Supabase Auth（採用）** | DB 統合・50,000 MAU 無料・RLS 連携 | — |
| Clerk | UI コンポーネントが最も洗練、実装最速 | 無料枠 10,000 MAU 超過で $25/月〜。DB と別サービスになり構成要素が増える（原則1・4 に反する）。本件に高度な組織管理等の Clerk 固有機能は不要 |
| Better Auth | セルフホストで無料・開発活発 | メール送信・パスワードリセット等の周辺を自前運用する必要があり「運用ゼロ志向」に反する |
| Auth.js（NextAuth） | 実績豊富 | メンテナンスモード（セキュリティ修正のみ）が報告されており新規採用は非推奨（FEASIBILITY §4） |

出典: FEASIBILITY §4（[認証比較 2026](https://www.buildmvpfast.com/blog/best-auth-providers-2026-clerk-supabase-comparison)、[Qiita 比較記事](https://qiita.com/DevMasatoman/items/7bcabe0325dfc3f8cc4d)）

---

## 5. AI・RAG

### 採用: Vercel AI SDK 6.x ／ LLM: Claude Haiku 4.5（Claude API 直接接続）／ 埋め込み: OpenAI text-embedding-3-small（AI Gateway 経由）

> **逸脱（2026-07-14・原則3）**: チャット LLM の呼び出し口を **Vercel AI Gateway 経由から Claude API 直接接続（`@ai-sdk/anthropic`）へ変更**した（ユーザー指示）。
> - **理由**: LLM 呼び出しを Anthropic へ直接行いたいというユーザー要求。認証は `ANTHROPIC_API_KEY`（Anthropic Console 発行）へ移行する。
> - **原則3 への影響は限定的**: 変更は AI SDK のプロバイダ関数を `gateway(id)` → `anthropic(id)` に差し替えるだけで、`streamText`/`useChat`/tool calling などの抽象は不変。モデル指定は引き続き `models.ts` の定数 1 箇所（`CHAT_MODEL_ID`）で、ドメイン層にベンダー型は漏れない。失われるのは「モデル ID 変更だけで 25+ プロバイダへ切替」できる Gateway の広さと、$5/月無料クレジット・単一キー運用のメリット。
> - **埋め込みは Gateway 経由のまま**（Anthropic に埋め込みモデルがないため）。結果として `ANTHROPIC_API_KEY`（チャット）と `AI_GATEWAY_API_KEY`（埋め込み）の 2 キー運用になる。

**選定理由（思想対応）**

- **差し替え可能な知能（原則3）を構造で実現**:
  - AI SDK はプロバイダ抽象化レイヤを持ち、モデル指定の変更のみで LLM を交換できる。retriever（pgvector + タグ SQL のハイブリッド検索）と generator（LLM）はコード上も分離する。
  - LLM・埋め込みとも AI SDK 越しに呼ぶため、プロバイダ実装（`@ai-sdk/anthropic` / `gateway`）を差し替えても `models.ts` のモデル ID 定数と呼び出しコードの外にベンダー型は漏れない（「ベンダー型をドメイン層へ漏らさない」を仕組みで担保）。
- **低コスト**: Claude Haiku 4.5 は $1/100万入力・$5/100万出力トークンで、月間 500 会話 $10〜15 程度（FEASIBILITY §3.2）。埋め込みが経由する AI Gateway は全プラン（Hobby 含む）で利用でき、$5/月の無料クレジット＋以降はプロバイダ定価（マークアップなし）。
- **シンプルさ**: `useChat` でストリーミング UI（非機能要件）、tool calling で「ヒアリング回答→DB 検索条件変換」と「銘柄 ID の structured output」（捏造防止、FR-08 受け入れ条件）が標準機能で書ける。
- **バージョン判断**: 2026-07 時点で `ai@7.0.14`（2026-07-02 リリース）が最新だが、リリース数日のメジャーは採用しない。**6.x 系（6.0.219 まで安定化済み、2025-12 リリース）を採用**し、v7 はエコシステム追従後に移行判断する。v5→v6 が大型破壊的変更だった経緯からも、メジャー直後の追従は避ける（流行に流されない）。
- **埋め込み**: text-embedding-3-small は $0.02/100 万トークンで日本語対応、1536 次元で pgvector と整合（FEASIBILITY §3.1 で裏取り済み）。全銘柄の初期埋め込みは $0.02 程度。

**類似技術との比較と不採用理由**

| 候補 | 評価 | 不採用理由 |
|---|---|---|
| **Vercel AI SDK（採用）** | ストリーミング・tool calling・プロバイダ抽象を標準装備。RAG 公式テンプレートあり。チャットは `@ai-sdk/anthropic`（Claude API 直接接続）、埋め込みは `gateway` プロバイダを使う | — |
| LangChain / LlamaIndex | RAG 部品が豊富 | 抽象化が厚く数千件規模の単純な RAG にはオーバーキル。破壊的変更が多く学習コストも高い（原則1 に反する） |
| Anthropic SDK（`@anthropic-ai/sdk`）直接利用 | 依存最少 | ストリーミング UI・useChat を自作する必要がある。**なお採用した `@ai-sdk/anthropic` は AI SDK のプロバイダ実装であり、この生 SDK ではない**（`streamText`/`useChat` の抽象は維持される） |
| LLM: GPT-4o mini / Gemini Flash 系 | 同価格帯 | 品質・価格は拮抗しており決定打はないが、FEASIBILITY で試算済みの Haiku 4.5 を初期値とする。AI SDK のプロバイダ抽象越しに呼ぶため、他社モデルへの切替も `models.ts` の定数変更（＋プロバイダ関数差し替え）で対応可能 |
| 埋め込み: Cohere embed-multilingual / Google embedding | 日本語性能は有力 | 価格・次元・実績で text-embedding-3-small と大差なく、FEASIBILITY で試算済みの初期値を維持。埋め込みモデル名と次元は設定値として持ち、差し替え時は再埋め込みバッチで対応（原則3） |

出典: [AI SDK 6 発表](https://vercel.com/blog/ai-sdk-6)、[vercel/ai releases](https://github.com/vercel/ai/releases)、[AI Gateway 料金](https://vercel.com/docs/ai-gateway/pricing)、[AI Gateway 概要](https://vercel.com/docs/ai-gateway)、[Claude API 料金](https://platform.claude.com/docs/en/about-claude/pricing)、[text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small)、[AI SDK RAG テンプレート](https://vercel.com/templates/next.js/ai-sdk-rag)

---

## 6. 検索

### 採用: Postgres ILIKE（読み仮名列併用）＋ タグ JOIN。件数増加時に pg_trgm インデックス追加

**選定理由（思想対応）**

- **シンプルさ・データ中心**: 検索対象は高々数千件。名前部分一致（ILIKE）＋正規化タグテーブルの JOIN で FR-06 の全条件（名前・都道府県・味の複合）を満たし、「検索 2 秒以内」は余裕で達成（FEASIBILITY §5.2）。外部検索サービスを増やさない。
- **表記ゆれ対策**: 銘柄に読み仮名列を持たせ両方を検索対象にする（FEASIBILITY R8）。
- **拡張パス**: 遅くなったら Supabase で有効化できる pg_trgm の GIN インデックスを足すだけ。アプリコードの検索インターフェースは変えない。

**類似技術との比較と不採用理由**

| 候補 | 評価 | 不採用理由 |
|---|---|---|
| **Postgres ILIKE + タグ JOIN（採用）** | 追加サービス・費用ゼロ。データと同居 | — |
| pg_trgm（即時導入） | 類似度検索・インデックス高速化 | 初期数百件では不要な複雑さ。必要になった時点で ALTER で追加できるため先回りしない（原則1）。**将来の第一拡張候補** |
| Algolia | 最高の検索 UX（タイポ耐性・即時） | 有料（無料枠はレコード/リクエスト制限が厳しい）。データの二重管理（DB→同期）が発生し、データ中心設計に反する。数千件規模でオーバーキル |
| Meilisearch | OSS で日本語対応良好 | セルフホストは「運用ゼロ志向」に反する。Meilisearch Cloud は月額費用が発生。同じく二重管理問題 |

出典: FEASIBILITY §5.2（Supabase での pg_trgm 利用可を確認済み）

---

## 7. UI

### 採用: Tailwind CSS v4 + shadcn/ui

**選定理由（思想対応）**

- **シンプルさ**: shadcn/ui はコンポーネントを**自分のリポジトリにコピー**する方式で、ランタイム依存やテーマ API のバージョン追従地獄がない。読んで追える素直なコードという原則1 に合致。
- 必要部品（カード一覧・検索フォーム・タブ・ダイアログ・チャット UI）が揃い、Tailwind でレスポンシブ対応（非機能要件）が最短。
- 2026-07 時点で全コンポーネントが Tailwind v4 / React 19 対応済みで、CLI から v4 プロジェクトを初期化できる（裏取り済み）。
- ロックイン最小: コードが手元にあるため、ライブラリ廃止リスクの影響を受けない。

**類似技術との比較と不採用理由**

| 候補 | 評価 | 不採用理由 |
|---|---|---|
| **Tailwind v4 + shadcn/ui（採用）** | コピー方式で依存が薄い。AI SDK チャット UI 作例が最多 | — |
| MUI | コンポーネント網羅性最大 | ランタイムが重く、テーマシステムの学習コストが高い。Material デザインからの脱却に工数がかかる。個人開発の小規模アプリには過剰（原則1） |
| Chakra UI | DX 良好 | v2→v3 で大きな破壊的変更があり API が流動的。Tailwind 系エコシステム（v0・作例・shadcn ブロック）の恩恵を受けられない |
| CSS Modules / 素の CSS | 依存ゼロ | チャット UI・ダイアログ等を自作する工数が開発速度優先のトレードオフ（思想の表）に反する |

出典: [shadcn/ui Tailwind v4 対応](https://ui.shadcn.com/docs/tailwind-v4)、[shadcn/ui changelog](https://ui.shadcn.com/docs/changelog)

---

## 8. ホスティング・インフラ

### 採用: Vercel（Hobby）＋ Supabase（Free）

**選定理由（思想対応）**

- **マネージド優先・運用ゼロ**: git push でデプロイ完了。サーバー・ミドルウェア運用なし。
- **低コスト**: Vercel Hobby は個人・非商用で無料。ストリーミング応答（チャット要件）対応。Supabase 無料枠は DB 500MB / 50,000 MAU / 5GB 帯域で十分（FEASIBILITY §3.2）。
- **一貫性**: Next.js・AI SDK・AI Gateway の開発元であり、スタック全体の相性問題が起きにくい。

**類似技術との比較と不採用理由**

| 候補 | 評価 | 不採用理由 |
|---|---|---|
| **Vercel + Supabase（採用）** | Next.js 最適・AI Gateway 統合・無料 | — |
| Cloudflare Pages/Workers | 無料枠が寛大、エッジ性能良好 | Next.js のフル機能は @opennextjs/cloudflare 経由となり、ランタイム差異（Node API 制約）のトラブルシュートが個人開発の負担になる（原則1 に反する）。AI Gateway 統合も Vercel 側が自然 |
| Netlify | デプロイ体験は同等 | Next.js の新機能（App Router 周辺）対応が Vercel より遅行しがち。本件で Vercel に対する優位点がない |
| VPS / コンテナ（Fly.io 等） | 自由度最大 | 自前運用そのものが「運用ゼロ志向」に反する |

**既知リスクと対策**（FEASIBILITY R6 再掲）: Supabase 無料枠は 7 日間アクセスなしで一時停止 → GitHub Actions の定期 ping（cron）で回避、本運用時は Pro（$25/月）を検討。Vercel Hobby は非商用限定 → 収益化時に Pro へ移行。

出典: FEASIBILITY §3.2（[Supabase 無料枠](https://www.itpathsolutions.com/supabase-free-tier-limits)）、[AI Gateway は Hobby プランで利用可](https://vercel.com/docs/ai-gateway/pricing)

---

## 9. テスト・CI

### 採用: Vitest 4 ＋ Playwright ＋ GitHub Actions

**選定理由（思想対応）**

- **Vitest 4**（2026-07 時点 4.1.x）: Vite ネイティブでゼロコンフィグに近く、TypeScript/ESM をそのまま実行。推薦スコア計算・タグ変換・検索条件変換など**純粋ロジックの単体テスト**を最小設定で書ける（原則1）。
- **Playwright**: 検索→一覧→詳細、チャット→提案カード→詳細という主要導線（FR-03/06/08 受け入れ条件）の E2E を担う。Windows でも安定動作。
- **GitHub Actions**: リポジトリと同居する無料 CI（パブリック無制限／プライベート 2,000 分/月）。lint + typecheck + Vitest を PR ごとに、Playwright は主要導線のみに絞り実行時間を節約。Supabase の定期 ping cron もここに置く。
- テスト戦略も「シンプルさ最優先」: ロジック（推薦・タグ変換・捏造防止の ID 検証）は Vitest で厚く、UI は E2E スモークで薄く。LLM 呼び出しはアダプタをモックし、実 API はテストで叩かない（コスト・原則3）。

**類似技術との比較と不採用理由**

| 候補 | 評価 | 不採用理由 |
|---|---|---|
| **Vitest + Playwright + GitHub Actions（採用）** | 事実上の現行標準。設定最小 | — |
| Jest | 実績最大 | ESM/TypeScript 設定が煩雑で、Vite 系ツールチェーンとの二重設定になる。新規なら Vitest が推奨される状況 |
| Cypress | E2E の老舗 | Playwright より遅く並列化が有料機能。マルチブラウザ対応も Playwright 優位 |
| CircleCI / GitLab CI | 機能同等 | GitHub にリポジトリを置く前提でサービスを増やす理由がない（原則1・4） |

出典: [Vitest 4.0 発表](https://vitest.dev/blog/vitest-4)、[vitest releases](https://github.com/vitest-dev/vitest/releases)

---

## 10. データ取得バッチ（さけのわ API インポート）

### 採用: ローカル実行の Node スクリプト（tsx）＋リポジトリ管理のシードファイル、Drizzle で upsert

**選定理由（思想対応）**

- **シンプルさ・運用ゼロ**: さけのわデータの更新頻度要件はない（スナップショット方針、FEASIBILITY R1）。常駐ジョブや cron 基盤は不要で、`npm run import:sakenowa` / `npm run seed` を開発者が手元（Windows）で実行し DB へ upsert する形が最小構成。
- **FR-01 受け入れ条件**: スクリプトは冪等な upsert（さけのわの brandId を自然キーに）とし、「再実行可能な手順」を README に整備する。
- **データ中心設計**: 説明文・種別タグ・読み仮名・価格帯の手作業シードは JSON/TS ファイルとしてリポジトリでバージョン管理し、データそのものをコードと同様にレビュー可能にする。
- 埋め込み生成（OpenAI API 呼び出し）も同スクリプト群の 1 ステップとして実装し、説明文更新時に差分再埋め込みする。
- 帰属表示（「さけのわデータを利用しています」＋リンク）はフッターに常設する（利用条件、FEASIBILITY §1.1）。

**類似技術との比較と不採用理由**

| 候補 | 評価 | 不採用理由 |
|---|---|---|
| **ローカルスクリプト＋シードファイル（採用）** | 基盤ゼロ・冪等・レビュー可能 | — |
| Vercel Cron + Route Handler | 定期自動更新が可能 | 更新頻度要件がなく、実行時間制限（Hobby）や監視の手間が増えるだけ。必要になってから移行すればよい（原則1） |
| Supabase Edge Functions（cron） | DB に近い場所で実行 | 同上。Deno ランタイムという追加学習コストも発生 |
| GitHub Actions の定期実行 | 無料で自動化可能 | 初期は手動で十分。**将来の自動化はこれを第一候補**とする（シークレット管理と実行ログが揃っているため） |

出典: FEASIBILITY §1（[さけのわデータプロジェクト](https://muro.sakenowa.com/sakenowa-data/)）

---

## 11. スタック全体の一貫性・リスク・ロックイン

### 一貫性の確認

- Next.js / AI SDK / AI Gateway / Vercel は同一ベンダーで相性問題が最小。Supabase は DB・ベクタ・認証を束ね、サービス総数は実質 4（Vercel・Supabase・AI Gateway 経由の LLM/埋め込み・GitHub）。
- データフローが一本: さけのわ API →（ローカルスクリプト）→ Supabase Postgres →（Drizzle）→ Next.js → 検索/推薦/RAG。思想の「同じ日本酒データを異なる方法で引く」を全領域が守る。

### ロックイン評価と緩和策

| 依存 | ロックイン度 | 緩和策 |
|---|---|---|
| Vercel（ホスティング） | 低 | Next.js は他ホストでも動く。Vercel 固有機能は AI Gateway のみに限定 |
| Supabase | 中 | 実体は素の Postgres + pgvector。`pg_dump` でどこへでも移行可。Auth のみ移行コストあり（アダプタ層で緩和） |
| AI Gateway / Claude / OpenAI 埋め込み | 低 | AI SDK のプロバイダ抽象＋Gateway でモデル ID 変更のみで切替（原則3 の狙いどおり） |
| さけのわ API | 低 | スナップショット方式で API 直依存なし（FEASIBILITY R1） |
| shadcn/ui | なし | コードが手元にある |

### 選定に伴う新規リスク

| リスク | 対策 |
|---|---|
| AI SDK v6→v7 の破壊的変更追従 | AI 呼び出しをアダプタ 1 箇所に集約し、移行影響を局所化。v7 はエコシステム安定後に判断 |
| Drizzle 経由アクセスが RLS を素通し | サーバ側 user_id フィルタの徹底＋RLS を defense-in-depth で有効化（§3） |
| Tailwind v4 の情報が v3 記事と混在 | 公式ドキュメント（v4）と shadcn/ui の v4 対応ガイドを正とする |

## 12. 決定記録（自律実行モードでの主な判断）

1. **AI SDK は 7 ではなく 6 系**: v7 はリリース直後（2026-07-02）のため見送り。安定性 > 新しさ。
2. **ORM は Drizzle（Prisma でなく）**: 推薦の集計 SQL を素直に書ける・軽量。Prisma 7 の改善は認識した上で、SQL 近接性を優先。
3. **pg_trgm は初期導入しない**: 数百件では不要。遅くなったら追加（先回りしない）。
4. **バッチの自動化はしない**: 更新頻度要件がないため手動実行。自動化する場合は GitHub Actions を第一候補。
5. **LLM/埋め込みは FEASIBILITY の試算済みモデルを初期値に**: Gateway 経由で常時差し替え可能なため、初期値の比較検証に時間をかけない。

## 13. 出典一覧

- Next.js 16 / 16.2: https://nextjs.org/blog/next-16 、https://nextjs.org/blog/next-16-2
- Vercel AI SDK 6: https://vercel.com/blog/ai-sdk-6 、https://github.com/vercel/ai/releases
- Vercel AI Gateway 料金・対応プラン: https://vercel.com/docs/ai-gateway/pricing 、https://vercel.com/docs/ai-gateway
- Drizzle vs Prisma（2026 比較）: https://makerkit.dev/blog/tutorials/drizzle-vs-prisma 、https://encore.dev/articles/drizzle-vs-prisma 、https://www.prisma.io/docs/orm/more/comparisons/prisma-and-drizzle
- shadcn/ui Tailwind v4 対応: https://ui.shadcn.com/docs/tailwind-v4 、https://ui.shadcn.com/docs/changelog
- Vitest 4: https://vitest.dev/blog/vitest-4 、https://github.com/vitest-dev/vitest/releases
- Supabase pgvector / 無料枠: https://supabase.com/docs/guides/database/extensions/pgvector 、https://www.itpathsolutions.com/supabase-free-tier-limits
- Claude API 料金: https://platform.claude.com/docs/en/about-claude/pricing
- OpenAI text-embedding-3-small: https://developers.openai.com/api/docs/models/text-embedding-3-small
- AI SDK RAG テンプレート: https://vercel.com/templates/next.js/ai-sdk-rag
- 認証比較: https://www.buildmvpfast.com/blog/best-auth-providers-2026-clerk-supabase-comparison 、https://qiita.com/DevMasatoman/items/7bcabe0325dfc3f8cc4d
- さけのわデータプロジェクト: https://muro.sakenowa.com/sakenowa-data/
