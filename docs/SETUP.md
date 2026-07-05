# SETUP — 実環境（Supabase / AI Gateway）投入手順

> 実装フェーズ（T01〜T16）完了後、実データ・実キーを投入してアプリを動かすための手順書。
> これまで各 `docs/REVIEW.md`・`docs/TASKS.md` 実施メモに散在していた「残作業」を 1 本に統合したもの。
>
> **セキュリティ厳守**: 接続文字列・API キー・パスワードは **`.env.local` にのみ**書き、コミットしない
> （`.gitignore` で `.env*` は除外済み）。**チャットや PR に貼らない**。値の取得は各自のダッシュボードで行う。

---

## 0. 前提と全体像

```
Supabase プロジェクト作成 → .env.local に接続情報          ┐
AI Gateway キー発行         → .env.local に AI キー          ┘→ npm run db:migrate（スキーマ・RLS・トリガ・pgvector）
                                                              → npm run import:sakenowa（さけのわ実データ ~3,300銘柄）
                                                              → npm run seed（自作説明文つき 76銘柄）
                                                              → npm run embed（説明文の埋め込み生成）
                                                              → npm run dev で動作確認 / npm run rag:poc で RAG 精度実測
```

所要: 初回 30〜60 分（Supabase 作成待ち・埋め込み生成含む）。コスト: Supabase 無料枠＋AI Gateway 従量（埋め込み数百円未満、チャットは利用次第で月 $10〜20 目安）。

---

## 1. Supabase プロジェクトを作成する（あなたの作業）

1. https://supabase.com/dashboard で新規プロジェクトを作成
   - リージョン: **Northeast Asia (Tokyo)** 推奨（日本ユーザー向けレイテンシ）
   - データベースパスワードは強固なものを設定し控えておく（接続文字列に含まれる）
2. 作成完了後（数分）、以下 3 つの値を取得:
   | 値 | 取得場所（新ダッシュボード） |
   |---|---|
   | Project URL | Project Settings → API → Project URL |
   | anon public key | Project Settings → API → Project API keys → `anon` `public` |
   | 接続文字列（DATABASE_URL） | **画面上部の「Connect」ボタン** → 下記のタブから選ぶ |

   > **注意**: 旧「Settings → Database → Connection string」は廃止された。現在は画面上部（プロジェクト名の近く）の
   > **緑色の「Connect」ボタン**をクリックし、開いたモーダルの接続文字列を使う。タブは Direct connection /
   > Transaction pooler / Session pooler の 3 種:
   - **マイグレーション・ローカル開発 → 「Session pooler」タブ（ポート 5432）**（DDL・prepared statement 対応・IPv4 可）
   - **Vercel 本番デプロイ → 「Transaction pooler」タブ（ポート 6543）**（サーバレスの接続枯渇回避。§6 参照）
   - Direct connection は IPv6 のみで家庭ネットワーク等から繋がらないことが多い。ローカルは Session pooler を使う。

   **コピーした接続文字列の `[YOUR-PASSWORD]` を、プロジェクト作成時の DB パスワードに置換する**こと。
   忘れた場合は Settings → Database → **Reset database password** で再設定できる。

---

## 2. `.env.local` を作成する（あなたの作業）

プロジェクトルートに `.env.local` を新規作成し、取得した値を入れる（`.env.example` がテンプレート）:

```dotenv
# Supabase（認証・DB）
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
# ローカル・マイグレーション用は Session pooler（5432）
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

# AI Gateway（埋め込み・LLM）※ §4 で発行
AI_GATEWAY_API_KEY=<vercel ai gateway key>
```

- `anon key` は RLS 前提の**公開可能キー**（クライアントに埋め込まれる。シークレットではない）。
- `DATABASE_URL`・`AI_GATEWAY_API_KEY` は**サーバ専用シークレット**。

---

## 3. スキーマ・データを投入する（コマンド）

`.env.local` を置いたら順に実行する（依存順・すべて冪等なので再実行可）:

```bash
# 1) スキーマ・RLS・トリガ・pgvector・HNSW を適用（drizzle/0000〜0002）
npm run db:migrate

# 2) さけのわ実データ（蔵元・銘柄・ランキング・味タグ）を冪等 upsert
npm run import:sakenowa

# 3) 自作説明文つきの主要 76 銘柄を投入（詳細ページ・RAG の実データ源）
npm run seed

# 4) 説明文の埋め込みを生成して sake_embeddings に格納（差分のみ・要 AI_GATEWAY_API_KEY）
npm run embed

# 5) 銘柄画像・楽天購入リンクを取得（差分のみ・要 RAKUTEN_APP_ID/RAKUTEN_ACCESS_KEY。§4.5）
#    既定は説明文つき銘柄（seed 分）のみ。--all で全銘柄、--force で再取得
npm run import:images
```

### pgvector が有効化できない場合
`db:migrate` の `CREATE EXTENSION IF NOT EXISTS vector` が権限で失敗したら、
Supabase Dashboard → Database → Extensions で **`vector`** を有効化してから `npm run db:migrate` を再実行する
（マイグレーションは冪等。`IF NOT EXISTS` なので二重有効化は無害）。

### 認証（メール確認設定）
Supabase の既定は **Confirm email = ON**。この場合サインアップ直後は未ログインで、アプリは
「確認メールを送信しました」を表示する（実装済み）。ログイン疎通をすぐ確認したいときは
Dashboard → Authentication → Providers → Email の **Confirm email を一時 OFF**（またはテストユーザーを
Dashboard で作成）すると、サインアップ→即ログインで `/history` まで到達できる。

---

## 4. AI Gateway のキーを発行する（あなたの作業）

RAG の埋め込み（text-embedding-3-small）と LLM（Claude Haiku 4.5）は Vercel AI Gateway 経由で呼ぶ。

1. https://vercel.com/dashboard → AI Gateway → API キーを発行
2. `.env.local` の `AI_GATEWAY_API_KEY` に設定
3. `npm run embed` を（再）実行して埋め込みを生成

> モデル ID は `src/lib/ai/models.ts` に定数化されている（`openai/text-embedding-3-small` /
> `anthropic/claude-haiku-4.5`）。Gateway 上の正確な ID が異なれば、この 1 ファイルの定数を変えるだけで切替可能。

## 4.5 楽天ウェブサービスのキーを発行する（あなたの作業・任意）

銘柄のパッケージ画像・楽天購入リンクは楽天市場 商品検索 API から取得する（FR-09。未設定でも
アプリは画像なしレイアウトで動く）。

1. https://webservice.rakuten.co.jp/ に楽天会員 ID でログイン → 「アプリID発行」
   - アプリケーションタイプ: API/バックエンドサービス ／ APIアクセススコープ: 楽天市場API
   - 許可された IP アドレス: バッチを実行するマシンのグローバル IP（`curl.exe ifconfig.me` で確認。
     回線の IP が変わって 403 になったら管理画面で更新）
2. 発行された **アプリケーションID** と **アクセスキー** を `.env.local` の
   `RAKUTEN_APP_ID` / `RAKUTEN_ACCESS_KEY` に設定
3. `npm run import:images` を実行（1 リクエスト/秒。seed 分 76 銘柄で約 2 分）
   - 誤マッチ抑止（銘柄名の包含・セット商品等の NG ワード）を通過した画像のみ保存される
   - 照合結果の監査ログが `tmp/rakuten-image-audit.csv` に出力される（目視確認用）
   - 画像は楽天 CDN の URL を参照表示する。自前ダウンロード・加工・保存はしない

---

## 5. 動作確認（コマンド）

```bash
# 開発サーバ
npm run dev
```

ブラウザで確認する主要動線:
- `/` — ホーム（未ログインは人気ランキング、ログイン後は履歴ベース推薦）
- `/search` — 名前・都道府県・味タグで検索 → 結果カード → `/sake/[id]` 詳細
- `/prefectures` → 都道府県別一覧
- `/login` `/signup` → 認証 → `/history`（保護ルート）
- `/chat` — 「どんなお酒を求めていますか？」→ 1〜2 問ヒアリング → 実在銘柄の提案カード

RAG の精度を数値で確認:
```bash
# 実埋め込みで recall@5 / MRR / hit@5 を実測（評価セット 10 パターン）
npm run rag:poc
```
- 実測に基づき retriever の重み（`src/lib/rag/retriever.ts` の `VECTOR_WEIGHT`/`TAG_WEIGHT`）を調整する。
- retriever のクエリ形状（B-1）が HNSW を使えているか、`docs/RAG_POC.md §8.4` の `EXPLAIN ANALYZE` 手順で確認する。

---

## 6. デプロイ（Vercel）※任意・DB 稼働後

1. Vercel に GitHub リポジトリを接続（Framework: Next.js は自動検出）
2. 環境変数を Vercel プロジェクトに設定:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `DATABASE_URL` は **Transaction pooler（6543）** の接続文字列を使う（サーバレスの接続枯渇回避。
     アプリは `prepare: false` 済みで両モード動作可）
   - `AI_GATEWAY_API_KEY`
3. デプロイ

### GitHub Actions（CI）の Secrets
- `SUPABASE_URL` / `SUPABASE_ANON_KEY`（＋任意で `DATABASE_URL`）を登録すると
  `.github/workflows/ping-supabase.yml` の定期 ping（無料枠 7 日停止対策）が有効化される。
- 上記＋`AI_GATEWAY_API_KEY` を登録すると、`e2e` ジョブのフルフロー E2E（検索・ログイン・チャット実 LLM）が
  自動的に skip 解除され実行される（未登録時は安定動線のみで安全にグリーン）。
  ※ フルフロー実行時は Playwright の trace（リクエスト/レスポンス・Cookie を含む）を artifact に載せる
    範囲とアクセス権限を再評価すること（`docs/REVIEW.md` T16 SEC S-1）。

---

## 7. 投入後の残タスク（実測して確定するもの）

| # | 作業 | 参照 |
|---|---|---|
| 1 | `npm run rag:poc` の実測に基づく retriever 重みの確定 | `docs/RAG_POC.md §9` |
| 2 | 実 LLM でヒアリング→提案の会話品質確認・システムプロンプト微調整 | `src/lib/ai/prompts.ts` |
| 3 | retriever B-1 の `EXPLAIN ANALYZE`（HNSW 使用可否・フィルタ形状別） | `docs/RAG_POC.md §8.4` |
| 4 | 味タグ変換のしきい値チューニング（フレーバー6軸→味タグ） | `docs/DESIGN.md §9` |
| 5 | Confirm email の運用方針決定（ON のまま/確認メール導線整備） | 本書 §3 |
| 6 | 無料枠停止対策 ping の実効性確認（初回 7 日期限前にダッシュボードで停止予告が無いこと） | `docs/TASKS.md` T02 残作業 |

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `db:migrate` が `DATABASE_URL 未設定` で停止 | `.env.local` に `DATABASE_URL`（Session pooler 5432）を設定 |
| `db:migrate` が vector 拡張で失敗 | Dashboard → Database → Extensions で `vector` を有効化して再実行（§3） |
| `embed`/チャットが認証エラー | `.env.local` の `AI_GATEWAY_API_KEY` を確認（§4） |
| サインアップ後ログインできない | Confirm email が ON。§3 の手順で OFF にするか確認メールのリンクを踏む |
| ホーム `/` が推薦を出さない | `import:sakenowa`→`seed`→`embed` まで完了しているか確認。履歴が無い新規ユーザーは人気ランキング表示が正常 |
| 数日アクセスが無く DB 停止 | 無料枠の一時停止。ダッシュボードで再開、または CI の ping Secrets を登録（§6） |
