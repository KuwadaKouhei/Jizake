# ディレクトリ構造設計書（DIRECTORY_STRUCTURE）— Jizake（日本酒レコメンドWebアプリ）

> 作成日: 2026-07-04
> 入力: `docs/DESIGN.md`（7コンポーネント・§1.4 方針・決定 D1〜D8）／`docs/TECH_STACK.md`（Next.js 16 App Router・
> Drizzle・shadcn/ui・Vitest・Playwright・ローカル tsx バッチ）／`docs/DATABASE.md`（10テーブル・drizzle-kit 運用）／
> `docs/philosophy/PLAN_PHILOSOPHY.md`（依存方向）／`docs/philosophy/CODING_PHILOSOPHY.md`（コロケーション・Rule of Three）／
> `docs/philosophy/TEST_PHILOSOPHY.md`（テスト比率・モック方針）
> 前提: グリーンフィールド（既存コードなし、`docs/` のみ）。自律実行モードのため、判断が必要な点は思想に沿って
> 決定し、理由を本書 §8（決定記録）に明記した。

---

## 1. 構造の基調

### 採用: 「App Router の機能型（ルート＝機能）」＋「横断ドメインは責務別 `src/lib`」のハイブリッド

| 層 | 基調 | 対応するもの |
|---|---|---|
| `src/app/` | **機能型**。ルートセグメント＝1機能とし、その機能専用のコードはセグメント配下のプライベートフォルダ（`_components` / `_lib` / `_actions`）にコロケーションする | カタログ・検索・認証画面・履歴・チャットUI |
| `src/lib/` | **ドメイン型**。画面をまたいで使う知能・基盤を責務名のディレクトリで分割する | 推薦・RAG・AIアダプタ・DB・認証ヘルパ |
| `scripts/` + `seed-data/` | **バッチ独立**。Webアプリのビルドに含まれないデータ投入系をルート直下に隔離する | データインポート |

**理由**

1. **FW規約が既に機能型である**: App Router は「URL＝ディレクトリ」であり、本アプリの機能（検索・詳細・県別・
   チャット・履歴・ログイン）はすべて URL を持つ。ルートセグメントを機能境界としてそのまま使うのが
   Convention over Configuration（CODING_PHILOSOPHY 原則1）に最も忠実で、独自の `features/` 層を発明しない。
2. **レイヤー型（`components/` `services/` `repositories/` の全社的分割）を採らない理由**: 機能を1つ触るのに
   3ディレクトリを行き来することになり、コロケーション原則に反する。個人開発規模で得るものがない。
3. **純粋なドメイン型（`domains/sake/` 配下に UI まで全部）を採らない理由**: App Router のルーティング規約と
   二重構造になり、ページとロジックの対応を別途覚える必要が生じる。FW 規約を優先する。
4. **推薦・RAG・AI・DB・認証だけ `src/lib` に置く理由**: これらは「複数画面・バッチ・APIルートから使うことが
   設計時点で確定している」横断ドメイン（DESIGN §1.4）。コロケーション原則の例外ではなく、
   「横断利用が確定したものは共有領域へ」という同原則の適用である。

### DESIGN.md の7コンポーネントとの対応

| # | コンポーネント（DESIGN §2） | 物理配置 |
|---|---|---|
| 1 | 日本酒カタログ | `src/app/page.tsx`・`src/app/sake/[id]/`・`src/app/prefectures/[code]/` ＋ 共有クエリ `src/lib/db/queries/` |
| 2 | 検索 | `src/app/search/`（クエリ組み立て純関数は `_lib/`） |
| 3 | 認証 | `src/app/login/`・`src/app/signup/`（画面）＋ `src/lib/auth/`（ヘルパ・actions）＋ `src/middleware.ts` |
| 4 | 履歴記録 | `src/app/history/`（参照画面）＋ 記録 Server Action は呼び出し元セグメントの `_actions/`（§8 決定 DIR-3） |
| 5 | 推薦エンジン | `src/lib/recommend/`（IF 固定・実装差し替え可能） |
| 6 | RAG チャットボット | `src/app/chat/`（UI）＋ `src/app/api/chat/`（Route Handler・ツール定義）＋ `src/lib/rag/`（retriever・ID検証） |
| 7 | データインポート | `scripts/`（tsx バッチ）＋ `seed-data/`（手作業データ）＋ `drizzle/`（マイグレーション） |

---

## 2. ディレクトリツリー（全体）

```
Jizake/
├─ .github/
│  └─ workflows/
│     ├─ ci.yml                        # lint + typecheck + Vitest（PR毎）、Playwright（主要導線）
│     └─ ping-supabase.yml             # 無料枠7日停止対策の定期 ping（TECH_STACK §8）
├─ docs/                               # 設計ドキュメント（既存）
│  └─ philosophy/
├─ drizzle/                            # drizzle-kit 生成 SQL ＋ カスタム SQL（RLS/トリガ/vector拡張/HNSW）
├─ e2e/                                # Playwright E2E（機能横断のため唯一テストを分離。§8 決定 DIR-5）
│  ├─ search-flow.spec.ts              # 検索→一覧→詳細
│  ├─ auth.spec.ts                     # サインアップ・ログイン
│  └─ chat.spec.ts                     # チャット1往復（LLM はモックエンドポイント）
├─ public/                             # 静的ファイル（Next.js 規約）
├─ scripts/                            # ローカル実行バッチ（tsx）。Web アプリのビルド対象外
│  ├─ import-sakenowa.ts               # さけのわ取り込み（冪等 upsert）
│  ├─ seed.ts                          # seed-data/ の手作業データ投入（冪等 upsert）
│  ├─ seed.test.ts                     # データ妥当性 + PGlite 統合（冪等・さけのわ共存・manual 付与）
│  ├─ embed.ts                         # 説明文の差分埋め込み生成
│  └─ lib/                             # スクリプト専用ヘルパ（データソース別サブディレクトリ）
│     ├─ sakenowa/
│     │  ├─ client.ts                  # さけのわ API 取得
│     │  ├─ schemas.ts                 # レスポンスの Zod 検証（境界）
│     │  ├─ flavor-to-tags.ts          # フレーバー6軸→味タグ変換（純関数）
│     │  ├─ flavor-to-tags.test.ts
│     │  └─ fixtures/                  # 保存済みレスポンス（テスト用フィクスチャ）
│     └─ seed/                         # 手作業シード（データソース）の境界
│        └─ schema.ts                  # seed-data/ の Zod 検証・型（境界）
├─ seed-data/                          # 手作業シード（説明文・種別タグ・読み仮名・URL・価格帯）。JSON/TS でレビュー可能
│  └─ sakes.ts                         # 主要銘柄の自作説明文つきデータ（ロジックは置かない）
├─ src/
│  ├─ app/                             # ルーティング＝機能境界（Next.js 規約）
│  │  ├─ layout.tsx                    # ルートレイアウト（ヘッダ＋さけのわ帰属フッター常設）
│  │  ├─ page.tsx                      # ホーム（推薦カード列の表示）
│  │  ├─ _components/                  # ホーム（/）専用の部品。※ app 全体共有は src/components へ
│  │  ├─ globals.css
│  │  ├─ error.tsx                     # 想定外エラーのバウンダリ（CODING_PHILOSOPHY 原則5）
│  │  ├─ not-found.tsx
│  │  ├─ search/                       # ─ 検索機能 ─
│  │  │  ├─ page.tsx                   # URL クエリパラメータ駆動（決定 D7）
│  │  │  ├─ _components/               # 検索フォーム・結果一覧・空状態
│  │  │  ├─ _lib/
│  │  │  │  ├─ build-search-query.ts   # URLパラメータ→検索条件の純関数（ユニットテスト対象）
│  │  │  │  ├─ build-search-query.test.ts
│  │  │  │  └─ search-sakes.ts         # searchSakes(params)（Drizzle クエリ）
│  │  │  └─ _actions/
│  │  │     └─ record-search.ts        # recordSearch Server Action（未ログイン時 no-op）
│  │  ├─ sake/
│  │  │  └─ [id]/                      # ─ カタログ: 詳細 ─
│  │  │     ├─ page.tsx
│  │  │     ├─ _components/            # タグ一覧・外部リンク・閲覧記録トリガ（Client Component）
│  │  │     └─ _actions/
│  │  │        └─ record-view.ts       # recordView Server Action
│  │  ├─ prefectures/
│  │  │  └─ [code]/                    # ─ カタログ: 都道府県別一覧 ─
│  │  │     └─ page.tsx
│  │  ├─ chat/                         # ─ RAG チャット UI ─
│  │  │  ├─ page.tsx
│  │  │  └─ _components/               # useChat・提案カード・フォールバック表示
│  │  ├─ history/                      # ─ 履歴参照（要ログイン、middleware でガード） ─
│  │  │  ├─ page.tsx
│  │  │  └─ _lib/
│  │  │     └─ queries.ts              # 本人の履歴取得（user_id はセッションから強制。引数で受けない）
│  │  ├─ login/
│  │  │  └─ page.tsx                   # 認証 actions は src/lib/auth/actions.ts を呼ぶ
│  │  ├─ signup/
│  │  │  └─ page.tsx
│  │  └─ api/
│  │     └─ chat/                      # ─ 唯一の Route Handler（ストリーミングのため） ─
│  │        ├─ route.ts                # 入力検証→streamText→ID検証→ストリーム
│  │        └─ _lib/
│  │           └─ tools.ts             # searchSake / proposeSake ツール定義（Zod スキーマ）
│  ├─ components/                      # 複数ルートで共有する UI（Rule of Three で昇格）
│  │  ├─ ui/                           # shadcn/ui 生成コンポーネント（CLI 既定の配置。編集可・昇格基準の対象外）
│  │  ├─ site-header.tsx               # 全ページ共通ヘッダ（ログイン状態表示）
│  │  ├─ site-footer.tsx               # さけのわ帰属表示フッター
│  │  └─ sake-card.tsx                 # 銘柄カード（ホーム推薦・検索結果・チャット提案で共用）
│  ├─ lib/                             # 横断ドメイン（責務名ディレクトリのみ。直下にファイルを置かない）
│  │  ├─ db/                           # ─ データアクセス基盤 ─
│  │  │  ├─ schema.ts                  # Drizzle スキーマ（10テーブル。型の単一情報源）
│  │  │  ├─ client.ts                  # DB クライアント生成
│  │  │  └─ queries/                   # 複数機能から使うカタログ読み取りクエリのみ
│  │  │     ├─ sakes.ts                # 詳細・県別一覧・SakeSummary 型
│  │  │     └─ tags.ts                 # タグ一覧
│  │  ├─ auth/                         # ─ 認証アダプタ（@supabase/ssr 標準パターン） ─
│  │  │  ├─ server.ts                  # サーバ用クライアント生成・現在ユーザー取得
│  │  │  ├─ client.ts                  # ブラウザ用クライアント生成
│  │  │  ├─ session.ts                 # middleware 用 updateSession
│  │  │  └─ actions.ts                 # signUp / signIn / signOut（ヘッダ等の横断 UI から呼ぶため lib 配置）
│  │  ├─ ai/                           # ─ AI アダプタ（AI SDK 呼び出しをここに集約） ─
│  │  │  ├─ models.ts                  # モデルID定数（Gateway 経由。差し替えはここだけ）
│  │  │  ├─ embedding.ts               # embedText(text)（Web とバッチで共用）
│  │  │  └─ prompts.ts                 # チャットのシステムプロンプト定数
│  │  ├─ recommend/                    # ─ 推薦エンジン（IF 固定・実装差し替え可能） ─
│  │  │  ├─ index.ts                   # recommend() のエクスポート（実装の選択はここだけ）
│  │  │  ├─ types.ts                   # RecommendedSake / RecommendReason（固定 IF）
│  │  │  ├─ rule-based.ts              # 初期実装（履歴集計 SQL＋スコアリング＋フォールバック）
│  │  │  ├─ scoring.ts                 # スコア計算の純関数（重み定数を注入可能に）
│  │  │  └─ scoring.test.ts
│  │  ├─ rag/                          # ─ RAG 検索部（LLM 非依存） ─
│  │  │  ├─ retriever.ts               # retrieveSakeCandidates()（SQL＋pgvector ハイブリッド）
│  │  │  ├─ retriever.test.ts          # テスト DB での統合テスト
│  │  │  ├─ validate-proposed.ts       # validateProposedSakeIds()（捏造防止の DB 存在検証）
│  │  │  └─ validate-proposed.test.ts
│  │  └─ constants/                    # ─ アプリ全体のドメイン定数のみ ─
│  │     ├─ prefectures.ts             # JIS 都道府県コードマスタ（47件固定、決定 D2）
│  │     └─ price-ranges.ts            # 価格帯3区分の表示名
│  └─ middleware.ts                    # Supabase セッション更新＋ /history ガード（lib/auth/session.ts を呼ぶ）
├─ .env.example                        # 必要な環境変数の一覧（実値はコミットしない）
├─ components.json                     # shadcn/ui CLI 設定
├─ drizzle.config.ts
├─ next.config.ts
├─ package.json                        # import:sakenowa / seed / embed の npm scripts
├─ playwright.config.ts
├─ tsconfig.json
└─ vitest.config.ts
```

> 注: `src/middleware.ts` は Next.js 16 系で `proxy.ts` への改名が推奨される場合、実装時に採用バージョンの
> 公式ドキュメントに従って改名してよい（配置は `src/` 直下のまま。本書の構造には影響しない）。

---

## 3. 責務表

| ディレクトリ | 責務（1つ） | 置いてよいもの / いけないもの |
|---|---|---|
| `src/app/` | URL を持つ機能の UI・入口 | ルーティングファイル＋セグメント専用の `_components` `_lib` `_actions`。**横断ロジックを置かない** |
| `src/app/<segment>/_components/` | そのセグメント専用の React 部品 | 他セグメントから import されたら `src/components` へ昇格 |
| `src/app/<segment>/_lib/` | そのセグメント専用のロジック・クエリ | 純関数・Drizzle クエリ・型。UI コンポーネントは置かない |
| `src/app/<segment>/_actions/` | そのセグメント（のページ）から呼ぶ Server Action | 書き込み mutation のみ。読み取りは `_lib` か RSC 直接クエリ |
| `src/app/api/chat/` | 唯一の Route Handler（ストリーミング） | チャット専用のツール定義（`_lib/`）。**2本目の API ルートは DESIGN §5.1 の基準を満たす場合のみ追加** |
| `src/components/` | 複数ルートで共有する UI | プレゼンテーション部品＋横断 UI（ヘッダ等）。ページ固有部品・ビジネスロジックは置かない |
| `src/components/ui/` | shadcn/ui の生成コード | CLI が生成したものと最小限のカスタマイズ。自作部品は直上の `src/components/` へ |
| `src/lib/db/` | スキーマ定義・DB クライアント・**横断**カタログクエリ | `queries/` は複数機能から使う読み取りのみ。機能固有クエリは各機能側に置く（肥大化防止） |
| `src/lib/auth/` | Supabase Auth との境界（アダプタ） | クライアント生成・セッション・認証 actions。supabase-js の型をここで閉じ、外に漏らさない |
| `src/lib/ai/` | AI SDK / AI Gateway との境界（アダプタ） | モデルID定数・埋め込み・プロンプト。**AI SDK の import はこのディレクトリと `/api/chat` のみに許可** |
| `src/lib/recommend/` | 推薦（履歴→銘柄リスト）。IF は `types.ts` で固定 | 実装は差し替え可能なファイル単位。スコア重み等の機能固有定数もここ |
| `src/lib/rag/` | RAG の検索部＋捏造防止検証。LLM 非依存 | generator（streamText 呼び出し）は置かない（それは `/api/chat` の責務） |
| `src/lib/constants/` | アプリ全体のドメイン定数 | 都道府県マスタ・価格帯区分など**複数機能が参照する不変のドメイン事実**のみ。機能固有定数は各機能へ |
| `scripts/` | データ投入バッチ（ローカル tsx 実行） | `src/lib/db`・`src/lib/ai` を import してよい。`src/app` は import 禁止 |
| `scripts/lib/<source>/` | データソース1つとの境界（取得・検証・変換） | Zod 検証・変換純関数・フィクスチャ。DB 書き込みはスクリプト本体で |
| `seed-data/` | 手作業データの実体（コードと同様にレビュー） | JSON/TS のデータのみ。ロジックを置かない |
| `drizzle/` | マイグレーション SQL（生成＋カスタム） | drizzle-kit 生成分と、RLS・トリガ・拡張・HNSW のカスタム SQL |
| `e2e/` | 主要導線の E2E テスト | Playwright spec のみ。ユニット・統合テストは置かない（ソース隣接） |
| `docs/` | 設計ドキュメント | — |

---

## 4. 可読性ルール

### 4.1 命名規約

| 対象 | 規約 | 例 |
|---|---|---|
| ディレクトリ | kebab-case。ルートセグメントは Next.js 規約（`[id]`・`_private`）に従う | `seed-data/`, `sake/[id]/` |
| ファイル（コンポーネント含む） | **すべて kebab-case**。エクスポートするコンポーネント名は PascalCase | `sake-card.tsx` が `SakeCard` を export |
| テスト | 対象ファイル名 + `.test.ts(x)`、対象の隣に置く | `scoring.ts` / `scoring.test.ts` |
| Server Action ファイル | 動詞始まりの kebab-case | `record-view.ts` |
| プライベートフォルダ | `_components` / `_lib` / `_actions` の3種のみ。他の `_名前` を発明しない | — |

コンポーネントファイルを PascalCase にしない理由: shadcn/ui の CLI 生成（`button.tsx` 等）と規則を1本化し、
Windows（大文字小文字非区別 FS）でのリネーム事故を避けるため。CODING_PHILOSOPHY の
「ファイルは kebab-case（FW 規約優先）」の適用を確定させたもの。

### 4.2 1ディレクトリ1責務

- 各ディレクトリの責務は §3 の表の1行で言い切れること。言い切れない分割は作らない。
- **`utils/` `common/` `helpers/` `shared/` `misc/` という名前のディレクトリ・ファイルは作成禁止**。
  共有したいコードは必ず「何の責務か」を名前にしたディレクトリへ置く（例: 日付整形が3箇所で必要になったら
  `src/lib/format/` のような責務名で作る）。
- `src/lib/` 直下にファイルを直接置かない（必ず責務ディレクトリ配下）。

### 4.3 階層深さの上限

- `src/` 起点でファイルまで**最大5階層**（例: `src/app/sake/[id]/_actions/record-view.ts` で5）。
- プライベートフォルダ（`_components` 等）の下にさらにサブディレクトリを掘らない。
  ファイル数が増えて整理したくなったら、それは機能の分割シグナル（セグメント分割か lib 昇格を検討する）。
- `src/lib/<責務>/` 配下は原則フラット（例外: `db/queries/` のみ1段許可）。

### 4.4 テストの同居/分離

| テスト種別 | 配置 | 理由 |
|---|---|---|
| ユニット・統合（Vitest） | **テスト対象ファイルの隣**（`*.test.ts`） | コロケーション原則。テストの存在有無が一目で分かり、機能削除時に消し忘れない |
| E2E（Playwright） | **ルート直下 `e2e/` に分離** | 機能横断の導線テストで単一の持ち主がいない。Playwright の慣例的配置と Vitest の対象グロブ分離も容易 |
| フィクスチャ | 使うテストの隣の `fixtures/` | 同上（コロケーション） |

---

## 5. 拡張性ルール

### 5.1 追加先決定表（新要素の置き場所が一意に決まる規則）

| 追加するもの | 置き場所（一意） |
|---|---|
| 新しい画面（URL を持つ） | `src/app/<route>/page.tsx`。専用部品・ロジック・actions は同セグメントの `_components` `_lib` `_actions` |
| 画面専用の部品・ロジック | そのセグメントの `_components` / `_lib` |
| ユーザー操作起点の書き込み | 呼び出すページのセグメントの `_actions/`。複数セグメントから呼ぶことが確定したら `src/lib/<責務>/actions.ts` へ昇格 |
| 複数ルートで使う UI 部品 | `src/components/`（3箇所目の利用が発生した時点で昇格。Rule of Three） |
| 複数機能で使うカタログ読み取りクエリ | `src/lib/db/queries/` |
| 機能固有のクエリ・定数・純関数 | その機能のディレクトリ（`_lib` または `src/lib/<機能>/`）。**db/queries・constants に置かない** |
| 推薦アルゴリズムの実装 | `src/lib/recommend/<実装名>.ts`（IF は `types.ts` を変えない） |
| RAG の検索改善（重み・条件） | `src/lib/rag/retriever.ts`（シグネチャ不変） |
| LLM・埋め込みモデルの変更 | `src/lib/ai/models.ts` の定数のみ |
| 新しい外部データソース | `scripts/import-<source>.ts` ＋ `scripts/lib/<source>/`（client / schemas / 変換 / fixtures） |
| 手作業データの追加・修正 | `seed-data/` |
| テーブル・カラムの追加 | `src/lib/db/schema.ts` → drizzle-kit 生成 → `drizzle/`。RLS 等は同フォルダのカスタム SQL |
| 2本目の API ルート | 原則作らない。ストリーミング等 RSC/Actions で表現不能な場合のみ `src/app/api/<name>/route.ts`（DESIGN §5.1） |
| ドメイン定数（複数機能が参照する不変の事実） | `src/lib/constants/<名前>.ts` |

### 5.2 依存方向（import 規約）

PLAN_PHILOSOPHY の「UI → サービス → データアクセス、外部サービスはアダプタ越し」をディレクトリ間ルールに変換する。

```
┌─ UI層 ──────────────────────────────────────────────┐
│ src/app（pages, _components, _actions, api/chat）    │
│ src/components（共有UI）                              │
└──────────────────┬───────────────────────────────────┘
                   ↓
┌─ 機能ロジック層 ─────────────────────────────────────┐
│ src/lib/recommend   src/lib/rag   （各 _lib も同格）  │
│ ※ recommend ⇄ rag ⇄ 検索(_lib) の相互 import 禁止    │
└──────────────────┬───────────────────────────────────┘
                   ↓
┌─ データアクセス・アダプタ層 ─────────────────────────┐
│ src/lib/db      src/lib/ai      src/lib/auth          │
└──────────────────┬───────────────────────────────────┘
                   ↓
│ src/lib/constants（どこからでも参照可・何にも依存しない）│
```

- **下から上への import は禁止**（`lib/db` や `lib/rag` が `src/app` や `src/components` を import しない）。
- **機能ロジック同士は横に依存しない**: 推薦・RAG・検索は `src/lib/db`（共通カタログ）にのみ依存する
  （DESIGN §1.3）。
- **ベンダー型を閉じ込める**: AI SDK の import は `src/lib/ai` と `src/app/api/chat` 配下のみ、
  `@supabase/*` の import は `src/lib/auth` 配下のみに許可。他の場所ではアプリ内の型だけを扱う。
- `src/components` は props 中心のプレゼンテーションに徹する。`src/lib` の actions・型の import は可、
  `src/app` の import は不可。
- `scripts/` は `src/lib/db`・`src/lib/ai`・`src/lib/constants`・`scripts/lib` のみ import 可。
  `src/app`・`src/components` は import 禁止（バッチが UI に依存しない）。
- 逆流や横断の誘惑が生じたら、それは共有クエリ（`lib/db/queries`）への抽出シグナルであり、
  機能同士を直接つなぐ理由にはしない。

### 5.3 共有領域の肥大化抑制

1. **入口を絞る**: 共有領域は `src/components`・`src/lib/db/queries`・`src/lib/constants` の3つと、
   責務名を持つ新規 `src/lib/<責務>/` のみ。汎用名ディレクトリの新設は禁止（§4.2）。
2. **昇格は Rule of Three**: 2箇所目まではコピーを許容し、3箇所目が現れた時点で昇格する。
   昇格時は必ず「責務名」を付ける（`utils.ts` に追記する逃げ道を塞ぐ）。
3. **降格も行う**: 共有領域のコードの利用箇所が1つに減ったら、その機能のディレクトリへ戻す。
4. **例外**: `src/components/ui/`（shadcn/ui 生成コード）は昇格基準の対象外。CLI が生成する場所であり、
   「使う予定で追加」してよい（コピー方式のため未使用でも実害はビルドサイズに現れない。ただし未使用が
   溜まったら削除する）。CLI 既定の `src/lib/utils.ts`（`cn` ヘルパ）は §4.2（`utils` 名・`lib` 直下
   ファイルの禁止）に合わせて `src/components/ui/cn.ts` へ配置し、`components.json` の `utils`
   エイリアスで以後の生成も追従させる（T01 で確定）。
5. `src/lib/constants` に置けるのは「複数機能が参照する不変のドメイン事実」のみ。推薦スコアの重み・
   チャット往復上限のような**機能固有の定数はその機能のディレクトリに置く**（constants をゴミ箱にしない）。

---

## 6. 自己検証（拡張シナリオ4例）

§5.1 の規則だけで配置先が一意に決まるかを検証した。

### 例1: 新しいタグ種別（category）を足す（例: `pairing`＝料理相性）

| 作業 | 配置先 | 決まり方 |
|---|---|---|
| CHECK 制約の変更 | `src/lib/db/schema.ts` → `drizzle/` に生成マイグレーション | 「テーブル・カラムの追加」規則 |
| タグの実データ投入 | `seed-data/`（手作業付与）→ `npm run seed` | 「手作業データ」規則 |
| （機械生成する場合）変換ロジック | `scripts/lib/sakenowa/` 等のソース側ディレクトリ | 「外部データソース」規則 |
| カテゴリ別の表示 | 既存のタグ表示部品（`sake/[id]/_components` 等）の修正 | 新ディレクトリ不要 |

→ **迷いなし**。新しいディレクトリは1つも増えない。

### 例2: 推薦アルゴリズムを差し替える（ルールベース → 協調フィルタリング）

| 作業 | 配置先 | 決まり方 |
|---|---|---|
| 新実装 | `src/lib/recommend/collaborative.ts`（新規ファイル） | 「推薦アルゴリズムの実装」規則 |
| 切り替え | `src/lib/recommend/index.ts` のエクスポート先変更のみ | IF（`types.ts`）固定のため |
| 呼び出し側 | `src/app/page.tsx` は**変更不要** | DESIGN §2.5 のとおり |

→ **迷いなし**。変更が `src/lib/recommend/` に閉じることを構造が保証する。

### 例3: 新しい画面を足す（例: タグ別一覧 `/tags/[name]`）

| 作業 | 配置先 | 決まり方 |
|---|---|---|
| ページ | `src/app/tags/[name]/page.tsx` | 「新しい画面」規則（URL＝ディレクトリ） |
| 画面専用部品 | `src/app/tags/[name]/_components/` | 同上 |
| タグ→銘柄クエリ | 既に検索と詳細が使うなら `src/lib/db/queries/`、この画面専用なら `_lib/` | 「機能固有 vs 横断」規則で二択が機械的に決まる |

→ **迷いなし**。「専用なら `_lib`、横断なら `db/queries`」の判定基準（実際に使う機能の数）が客観的。

### 例4: 新しい外部データソースを足す（例: 楽天 API で購入リンク補完）

| 作業 | 配置先 | 決まり方 |
|---|---|---|
| 取り込みスクリプト | `scripts/import-rakuten.ts` | 「外部データソース」規則 |
| API クライアント・Zod 検証・変換 | `scripts/lib/rakuten/`（client / schemas / 変換 / fixtures） | 同上（さけのわと同型のサブディレクトリ） |
| 書き込み先カラム | `sakes.rakuten_url` は定義済み（DATABASE §2.2）。変更不要 | — |
| npm script | `package.json` に `import:rakuten` 追加 | 既存の `import:sakenowa` と同型 |

→ **迷いなし**。データソース1つ＝`scripts/lib/` 配下の1ディレクトリ、という対応が既存例（sakenowa）から複製できる。

---

## 7. 思想・FW規約との整合

| 観点 | 整合の確認 |
|---|---|
| Next.js App Router 標準レイアウト | `src/` ディレクトリ・`app/` ルーティング・プライベートフォルダ・Route Handler・middleware 配置はすべて公式規約どおり。独自レイヤーなし |
| shadcn/ui | `src/components/ui/` ＋ `components.json` は CLI 既定 |
| drizzle-kit | `drizzle/`（出力先）＋ `drizzle.config.ts` は既定。カスタム SQL も同列管理（DATABASE §1.5） |
| コロケーション（CODING_PHILOSOPHY 4） | 機能専用コードはセグメント配下。テストはソース隣接。横断確定分のみ `src/lib` |
| Rule of Three（同 3） | §5.3 で昇格・降格基準として明文化。汎用名ディレクトリ禁止で `utils` 肥大化を構造的に排除 |
| 依存方向（PLAN_PHILOSOPHY） | §5.2 で import 規約化。ベンダー型の閉じ込め場所（`lib/ai`・`lib/auth`）を物理的に固定 |
| テスト思想 | ユニット厚め（純関数がすべて独立ファイルで隣にテスト）・E2E は3導線のみ `e2e/` に分離 |

### 逸脱と理由

| # | 逸脱 | 理由 |
|---|---|---|
| 1 | **E2E テストのみコロケーションしない**（ルート直下 `e2e/`） | E2E は「検索→詳細」のように機能を横断し、単一の持ち主セグメントが存在しない。Playwright の標準的な分離配置に従う方が FW 規約優先の原則に合致。Vitest の対象グロブから除外する設定も単純になる |
| 2 | **shadcn/ui 生成コードは Rule of Three の対象外**（§5.3 例外4） | コピー方式のライブラリコードであり「自作コードの早すぎる共通化」という原則の対象ではない。CLI の生成先を動かすと以後の追加が規約から外れる |
| 3 | **`src/components/sake-card.tsx` は利用画面が揃う前に共有配置する**（Rule of Three の先行昇格） | 銘柄カードは本ツリー §2 と TASKS.md T05④ の設計時点で「県別一覧(T06)・検索結果(T07)・推薦(T10)・チャット提案(T14)」の 4 画面での共用が確定している。T05 の詳細ページ自体は独自レイアウトのため直接は使わないが、次タスク以降で確実に 3 箇所を超える。各画面の `_components/` にコピーを置いてから昇格するより、最初から共有に置く方が破壊的移動を避けられる。shadcn 生成コード（例外2）と同じ「使う予定が確定した部品の先行配置」として許容する |

上記以外に思想・FW 規約からの逸脱はない。DESIGN §1.4 の方針スケッチからの**詳細化**（逸脱ではない）は
§8 の決定記録に残す。

---

## 8. 決定記録（本書での判断）

| # | 決定 | 採用 | 却下案 | 理由 |
|---|---|---|---|---|
| DIR-1 | 構造の基調 | App Router 機能型＋責務別 `src/lib` のハイブリッド | 全面レイヤー型／`features/` ドメイン型 | §1 のとおり。FW のルーティング規約自体が機能境界であり、二重構造を作らない |
| DIR-2 | プライベートフォルダの語彙 | `_components` / `_lib` / `_actions` の3種に固定 | セグメントごとに自由命名 | 追加先の一意性（§5.1）は語彙が固定されて初めて成立する。DESIGN §1.4 は `_components`/`_lib` の2種だったが、書き込み（Server Action）は読み取りロジックと責務が異なるため `_actions` を追加して詳細化 |
| DIR-3 | 履歴記録 Server Action の配置 | 呼び出し元セグメントの `_actions/`（`sake/[id]` と `search` に各1つ） | `src/lib/history/` に集約 | `recordView` は詳細ページ、`recordSearch` は検索ページからしか呼ばれず「横断利用が確定」していない（コロケーション原則）。書き込み先が同系テーブルという理由だけで共有領域を作るのは早すぎる抽象化。3箇所目の呼び出しが現れたら §5.1 の規則で昇格する |
| DIR-4 | 認証 Server Action の配置 | `src/lib/auth/actions.ts` | `login/` `signup/` 各セグメントの `_actions/` | signOut は共通ヘッダ（`src/components`）から呼ばれ、最初から横断利用が確定している。auth は既にアダプタとして `src/lib/auth` を持つため、そこへ同居させるのが 1責務1ディレクトリに合致 |
| DIR-5 | テスト配置 | ユニット・統合はソース隣接、E2E のみ `e2e/` 分離 | `tests/` に全部集約／全部隣接 | §4.4 のとおり。全部集約はコロケーション違反、E2E の隣接は持ち主が決められない |
| DIR-6 | 機能固有クエリの配置 | 使う機能のディレクトリ（`_lib` や `lib/recommend`）。`db/queries` は横断分のみ | 全クエリを `lib/db/queries` に集約 | 集約案はレイヤー型の発想で、`db/queries` が全機能の変更理由を抱えるゴミ箱になる。データアクセス層の本質（schema・client・共有読み取り）だけを db に残す |
| DIR-7 | スクリプト専用ヘルパの置き場 | `scripts/lib/<データソース名>/` | `src/lib` に同居 | さけのわ API クライアントや味タグ変換は Web アプリから使われない。`src/` に置くとビルド対象・依存方向の管理が濁る。データソース名でサブディレクトリを切ることで例4（新ソース追加）の追加先が一意になる |
| DIR-8 | コンポーネントのファイル名 | kebab-case に統一 | PascalCase.tsx | shadcn/ui 生成と規則を1本化。Windows の大文字小文字非区別によるリネーム事故を回避（§4.1） |
| DIR-9 | 共有定数の置き場 | `src/lib/constants/`（ドメイン事実のみ） | 各所に散在／`config/` ディレクトリ | 都道府県マスタ（決定 D2 のテーブル化しない判断）に物理的な置き場が必要。ただし受け入れ範囲を「不変のドメイン事実」に限定し、機能固有定数の流入を規則で遮断（§5.3-5） |
