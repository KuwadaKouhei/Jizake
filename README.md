# Jizake

> 日本酒データベースを軸に、検索・都道府県別地酒・履歴ベース推薦・RAG チャットボットを提供する日本酒レコメンド Web アプリ。

![Next.js](https://img.shields.io/badge/Next.js-16.2-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-06B6D4?logo=tailwindcss&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-base--nova-000000)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20pgvector-3FCF8E?logo=supabase&logoColor=white)
![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?logo=drizzle&logoColor=black)
![Vercel AI SDK](https://img.shields.io/badge/Vercel_AI_SDK-6.x-000000?logo=vercel&logoColor=white)
![Claude Haiku 4.5](https://img.shields.io/badge/LLM-Claude_Haiku_4.5-D97757?logo=anthropic&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-4.x-6E9F18?logo=vitest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-1.x-2EAD33?logo=playwright&logoColor=white)

---

## 概要

Jizake は日本酒のデータベースを構築し、以下を提供する Web アプリケーションです。

- **検索**: 名前（部分一致）・都道府県・味わいタグでの複合検索と結果一覧
- **都道府県別・地酒マップ**: 日本地図または一覧から都道府県を選んでその県の地酒を表示
- **詳細ページ**: 説明・特徴タグ・味わいレーダー・銘柄画像・外部リンク（公式／購入）・価格帯
- **認証**: メール＋パスワード、および Google OAuth によるサインアップ／ログイン
- **履歴**: ログインユーザーの閲覧・検索履歴の記録
- **履歴ベース推薦**: 履歴からタグ頻度で嗜好を推定したホームのおすすめ（履歴が無ければ人気ランキングにフォールバック）
- **お気に入り**: 銘柄の登録・解除と一覧（本人のみ参照可能）
- **RAG チャットボット**: 「どんなお酒を求めていますか？」から数問ヒアリングし、日本酒 DB を知識源に実在銘柄を提案

未ログインでも閲覧・検索・チャットは利用でき、履歴・推薦・お気に入りのみログインが必要です。

要件の詳細は [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)（FR-01〜FR-10）を参照してください。

---

## プロジェクト思想

設計・実装は [`docs/philosophy/`](docs/philosophy) の思想に沿います。要点は以下のとおりです。

- **シンプルさ最優先**: 凝った抽象化より読んで追える素直な構造を選ぶ。
- **データ中心設計**: 日本酒データとタグを設計の中心に置き、検索・推薦・RAG を「同じデータを異なる方法で引く」機能として統一的に捉える。
- **差し替え可能な知能**: 推薦はインターフェースを固定して実装を差し替え可能にし、RAG は検索部（retriever）と生成部（LLM）を分離する。
- **マネージド優先・運用ゼロ志向**: DB・認証・ホスティング・LLM はマネージドサービスを使い無料枠〜低コストに収める。
- **境界で型厳格**: 外部サービス（LLM・認証・データソース）はアダプタ越しに使い、ベンダー型をドメイン層へ漏らさない。
- **LLM は必ずモック**: テストで実 LLM API は叩かず、アダプタをモックする。

### 工夫点

- **RAG の捏造防止 二段構え**: LLM には retriever が返した実在 ID のみを提案候補として渡し、さらに提案 ID を DB 存在検証（[`src/lib/rag/validate-proposed.ts`](src/lib/rag/validate-proposed.ts)）で照合してから表示する。
- **retriever は LLM 非依存**: 検索部（pgvector ＋ タグ SQL のハイブリッド）は LLM に依存せず、埋め込み・LLM の変更がアプリ本体に波及しない。
- **誤りより非表示を優先（安全側）**: 銘柄画像は誤マッチ抑止を通過したものだけを表示し、取得できない銘柄は共通の No Image を出す。RAG も DB に無い銘柄は提案しない。

---

## 技術スタック

| 領域 | 採用 |
|---|---|
| 言語 | TypeScript 5.x |
| フレームワーク | Next.js 16（App Router）/ React 19 |
| UI | Tailwind CSS v4 + shadcn/ui（base-nova） |
| DB / ベクタ | Supabase Postgres + pgvector |
| ORM / マイグレーション | Drizzle ORM + drizzle-kit |
| 認証 | Supabase Auth（@supabase/ssr。メール + Google OAuth） |
| AI フレームワーク | Vercel AI SDK 6.x |
| LLM ルーティング | Vercel AI Gateway |
| LLM / 埋め込み | Claude Haiku 4.5 / OpenAI text-embedding-3-small（1536 次元） |
| 検索 | Postgres ILIKE + タグ JOIN |
| ホスティング | Vercel（Tokyo リージョン固定） |
| テスト | Vitest 4（単体・結合）/ Playwright（E2E） |

選定理由は [`docs/TECH_STACK.md`](docs/TECH_STACK.md) に記載しています。

---

## 環境変数

実値は `.env.local` にのみ置き、コミットしません（`.env*` は `.gitignore` 済み）。テンプレートは [`.env.example`](.env.example)、取得手順は [`docs/SETUP.md`](docs/SETUP.md) が正です。

| 変数名 | 用途 | 必須 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL（認証・DB） | 必須 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon public key（RLS 前提の公開可能キー） | 必須 |
| `DATABASE_URL` | Postgres 接続文字列（ローカルは Session pooler 5432、本番は Transaction pooler 6543） | 必須 |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway のキー（埋め込み生成・RAG チャット。サーバ専用） | 埋め込み・チャットに必須 |
| `RAKUTEN_APP_ID` | 楽天ウェブサービスのアプリケーション ID（画像取得バッチ専用） | 任意（本番不要） |
| `RAKUTEN_ACCESS_KEY` | 楽天ウェブサービスのアクセスキー（画像取得バッチ専用） | 任意（本番不要） |

`NEXT_PUBLIC_*` 以外はサーバ専用シークレットです。秘密値は載せず、変数名と用途のみ管理してください。

---

## コマンド一覧

`package.json` の scripts です。`npm run <name>` で実行します。

| コマンド | 用途 |
|---|---|
| `dev` | 開発サーバを起動 |
| `build` | 本番ビルド |
| `start` | ビルド済みアプリを起動 |
| `lint` | ESLint による静的解析 |
| `typecheck` | `tsc --noEmit` で型チェック |
| `test` | Vitest による単体・結合テスト |
| `test:watch` | Vitest をウォッチモードで実行 |
| `test:e2e` | Playwright による E2E テスト |
| `format` / `format:check` | Prettier による整形 / 整形チェック |
| `db:generate` | スキーマからマイグレーション SQL を生成（drizzle-kit） |
| `db:migrate` | マイグレーション（スキーマ・RLS・トリガ・pgvector・HNSW）を適用 |
| `import:sakenowa` | さけのわ API から実データを冪等 upsert |
| `seed` | 自作説明文つきの主要銘柄を投入（詳細ページ・RAG の実データ源） |
| `embed` | 説明文の埋め込みを差分生成（要 `AI_GATEWAY_API_KEY`） |
| `import:images` | 楽天 API から銘柄画像・購入リンクを取得（要 `RAKUTEN_*`） |
| `rag:poc` | RAG 精度 PoC（recall@k / MRR / hit@k）を実測 |

---

## ディレクトリ構成

配置ルールの詳細は [`docs/DIRECTORY_STRUCTURE.md`](docs/DIRECTORY_STRUCTURE.md) を参照してください。

```
Jizake/
├─ src/
│  ├─ app/               # ルーティング＝機能境界（Next.js App Router）
│  │  ├─ page.tsx        # ホーム（履歴ベース推薦 / 人気）
│  │  ├─ search/         # 検索
│  │  ├─ sake/[id]/      # 詳細（タグ・レーダー・画像・閲覧記録）
│  │  ├─ prefectures/    # 都道府県別一覧・地酒マップ
│  │  ├─ chat/           # RAG チャット UI
│  │  ├─ history/        # 履歴参照（要ログイン）
│  │  ├─ favorites/      # お気に入り一覧
│  │  ├─ login/ signup/  # 認証画面
│  │  └─ api/chat/       # 唯一の Route Handler（ストリーミング・ツール定義）
│  ├─ components/        # 複数ルートで共有する UI（shadcn/ui は ui/）
│  └─ lib/               # 横断ドメイン（責務名ディレクトリ）
│     ├─ auth/           # Supabase Auth アダプタ
│     ├─ db/             # Drizzle スキーマ・クライアント・共有クエリ
│     ├─ ai/             # AI SDK / AI Gateway アダプタ（モデル ID・埋め込み・プロンプト）
│     ├─ rag/            # RAG 検索部（retriever）＋ 捏造防止の ID 検証
│     ├─ recommend/      # 推薦エンジン（IF 固定・実装差し替え可能）
│     ├─ search-query/   # URL⇔検索条件の純関数
│     ├─ pagination/     # ページ番号処理の純関数
│     └─ constants/      # 都道府県マスタ等のドメイン定数
├─ drizzle/              # マイグレーション SQL（生成 + RLS/トリガ/拡張）
├─ scripts/              # ローカル実行バッチ（tsx。import / seed / embed / rag-poc）
├─ seed-data/            # 手作業シード（説明文・タグ・読み仮名・価格帯）
├─ e2e/                  # Playwright E2E（検索・認証・チャット）
└─ docs/                 # 設計ドキュメント
```

---

## 開発環境の構築

前提: Node.js（`@types/node` は 20 系）、Supabase プロジェクト、Vercel AI Gateway キー。詳細な取得手順は [`docs/SETUP.md`](docs/SETUP.md) が正です。

```bash
# 1) 取得と依存インストール
git clone <this-repo>
cd Jizake
npm install

# 2) 環境変数を用意（.env.example をテンプレートに .env.local を作成し実値を記入）
#    NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / DATABASE_URL / AI_GATEWAY_API_KEY

# 3) スキーマ・データを投入（依存順・すべて冪等なので再実行可）
npm run db:migrate        # スキーマ・RLS・トリガ・pgvector・HNSW
npm run import:sakenowa   # さけのわ実データを upsert
npm run seed              # 自作説明文つき銘柄を投入
npm run embed             # 説明文の埋め込みを生成（要 AI_GATEWAY_API_KEY）
npm run import:images     # （任意）楽天から銘柄画像・購入リンクを取得（要 RAKUTEN_*）

# 4) 開発サーバ起動
npm run dev
```

---

## トラブルシューティング

代表的なものを抜粋します。全項目は [`docs/SETUP.md`](docs/SETUP.md) のトラブルシューティング表を参照してください。

| 症状 | 対処 |
|---|---|
| `db:migrate` が `DATABASE_URL 未設定` で停止 | `.env.local` に `DATABASE_URL`（ローカルは Session pooler 5432）を設定 |
| `db:migrate` が vector 拡張で失敗 | Supabase Dashboard → Database → Extensions で `vector` を有効化して再実行 |
| `embed` / チャットが認証エラー | `AI_GATEWAY_API_KEY` を確認（AI Gateway はキー発行にカード登録が必要） |
| Google ログインが失敗する | Supabase の Redirect URLs にコールバック（`http://localhost:3000/auth/callback` 等）を登録 |
| サインアップ後ログインできない | Confirm email が ON。確認メールを踏むか一時 OFF にする |
| 数日アクセスが無く DB が停止 | Supabase 無料枠の一時停止。Dashboard で再開、または CI の定期 ping を有効化 |

---

## デプロイ

Vercel を前提とし、リージョンは [`vercel.json`](vercel.json) で Tokyo（`hnd1`）に固定しています。環境変数の本番設定・認証 URL の切り替え等の手順は [`docs/SETUP.md`](docs/SETUP.md) §6 を参照してください。

---

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | 要件定義（FR-01〜FR-10 と受け入れ条件） |
| [`docs/FEASIBILITY.md`](docs/FEASIBILITY.md) | 実現可能性調査（さけのわ／楽天 API・RAG 構成の裏取り） |
| [`docs/TECH_STACK.md`](docs/TECH_STACK.md) | 技術選定（採用スタックと選定理由） |
| [`docs/DESIGN.md`](docs/DESIGN.md) | アーキテクチャ設計（7 コンポーネント・決定記録） |
| [`docs/DATABASE.md`](docs/DATABASE.md) | DB 設計（テーブル・ER 図・命名規約・RLS 方針） |
| [`docs/DIRECTORY_STRUCTURE.md`](docs/DIRECTORY_STRUCTURE.md) | ディレクトリ構造（配置ルール・決定記録） |
| [`docs/SETUP.md`](docs/SETUP.md) | 実環境投入・デプロイ手順の正 |
| [`docs/philosophy/PLAN_PHILOSOPHY.md`](docs/philosophy/PLAN_PHILOSOPHY.md) | 設計思想（シンプルさ・データ中心・差し替え可能な知能） |
| [`docs/philosophy/CODING_PHILOSOPHY.md`](docs/philosophy/CODING_PHILOSOPHY.md) | 実装思想（FW 規約優先・境界で型厳格・コロケーション） |
| [`docs/philosophy/TEST_PHILOSOPHY.md`](docs/philosophy/TEST_PHILOSOPHY.md) | テスト思想（比率目安・LLM 必須モック・受け入れ条件対応） |
| [`docs/GIT_CONVENTIONS.md`](docs/GIT_CONVENTIONS.md) | Git 運用（ブランチ・Conventional Commits・禁止事項） |
| [`docs/TASKS.md`](docs/TASKS.md) | タスク分解（T01〜・依存関係・状態管理） |
| [`docs/SAKENOWA_API.md`](docs/SAKENOWA_API.md) | さけのわ API 調査メモ（実測レスポンス・利用規約） |
| [`docs/RAG_POC.md`](docs/RAG_POC.md) | RAG 精度 PoC の評価手順・指標 |
| [`docs/REVIEW.md`](docs/REVIEW.md) | レビュー記録 |

---

データ提供: 銘柄データの一部に「さけのわデータ」を利用しています。銘柄画像・購入リンクは楽天市場 商品検索 API から取得します。
