# E2E テスト（Playwright・主要 3 導線）

主要導線の回帰保証（TEST_PHILOSOPHY: E2E は 3 導線のみ・比率 10%）。機能横断のため
ソース隣接ではなくルート直下の `e2e/` に分離する（DIRECTORY_STRUCTURE 決定 DIR-5）。

## 3 導線

| ファイル | 導線 | 対応 FR |
|---|---|---|
| `search-flow.spec.ts` | 検索→一覧→詳細 | FR-06 / FR-07 / FR-02 |
| `auth.spec.ts` | ログイン（サインアップ・ログイン・保護ルート誘導） | FR-04 |
| `chat.spec.ts` | チャット 1 往復 | FR-08 |

## 実データ/実キー有無による分割（重要）

自律実行モードの制約で **Supabase 実 DB・AI Gateway キーが未設定の環境**がある。DB/LLM に
依存する画面は接続情報が無いと 500 になるため、E2E を 2 層に分けている。

### 安定動線（DB/キー無しでも常に実行・CI の既定）

接続情報が無くても 200 で到達できる画面だけを検証する。`npm run build && npm run start` で
実測した各ページのステータス（DB/キー無し）:

| パス | ステータス | E2E での扱い |
|---|---|---|
| `/prefectures` | 200（静的・DB 非依存） | 県選択 UI・47 県リンクを検証 |
| `/login` `/signup` | 200（`getCurrentUser` は未設定時 null 安全） | フォーム要素を検証 |
| `/history`（未ログイン） | 307 → `/login?next=%2Fhistory` | proxy ガードの誘導を検証（DB 不要で効く） |
| `/chat` | 200（LLM 呼び出しは送信時のみ） | 入力 UI ＋ `/api/chat` をモックした 1 往復を検証 |
| `/` `/search` `/sake/[id]` `/prefectures/[code]` | 500（DB 接続要求） | 安定動線では触れない（フルフローで検証） |

チャットの 1 往復は `page.route("**/api/chat")` で AI SDK v6 の UIMessageStream（SSE）を
モックし、サーバの LLM・retriever・DB を一切叩かずに「送信 → 応答テキスト → 検証済み提案
カード（/sake/[id] リンク）」の UI 配線を検証する（TASKS T16: 「LLM はモックエンドポイント」）。

### フルフロー（実データ/実キーがある環境のみ実行）

各 spec 冒頭の `test.skip(!process.env.X)` で、必要な環境変数が無ければ自動スキップする。

| 導線 | 必要な環境変数 | 内容 |
|---|---|---|
| 検索→一覧→詳細 | `DATABASE_URL` | `/search` 実行→結果カード→詳細遷移、`/prefectures/[code]` 一覧→詳細 |
| ログイン | `NEXT_PUBLIC_SUPABASE_URL` ＋ `NEXT_PUBLIC_SUPABASE_ANON_KEY` | サインアップ→ログイン→保護ページ `/history` 到達 |
| チャット | `AI_GATEWAY_API_KEY` | 実 LLM への 1 メッセージ送信→ストリーミング応答 |

## ローカル実行

```bash
# 安定動線のみ（DB/キー無し。build&start を自動で起動して回す）
npm run test:e2e

# 反復を速くしたい場合: 別ターミナルで本番サーバを起動しておき、build&start をスキップ
# ポートは playwright.config.ts の PLAYWRIGHT_PORT（既定 3100）と揃える
npm run build && npm run start -- --port 3100
PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test
```

> webServer の起動ポートは環境変数 `PLAYWRIGHT_PORT`（既定 3100）で変更できる。外部サーバを
> `PLAYWRIGHT_BASE_URL` で指す場合は、そのサーバのポートと URL を一致させること。

### フルフローをローカルで走らせる手順（実データ/実キー投入後）

1. Supabase プロジェクト作成後、`.env.local` に接続情報を設定（`.env.example` 参照）
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `DATABASE_URL`
   - `AI_GATEWAY_API_KEY`
2. マイグレーション適用・データ投入・埋め込み生成（各タスクの残作業）:
   ```bash
   npm run db:migrate
   npm run import:sakenowa   # さけのわ実データ
   npm run seed              # 手作業シード（説明文）
   npm run embed             # 説明文の埋め込み（AI Gateway キーが必要）
   ```
3. E2E を実行（`.env.local` の値が build&start したサーバへ渡り、各 spec の skip が外れる）:
   ```bash
   npm run test:e2e
   ```
   ※ ログインのフルフローは Supabase の **Confirm email** 設定に挙動が依存する（T08 残作業）。
     Confirm email が ON の場合、サインアップ直後は未確認セッションになり得るため、spec は
     「ログイン成立で `/history` 到達」または「未確立なら `/login` へ誘導」のどちらでも通す。

## CI

`.github/workflows/ci.yml` の `e2e` ジョブが `checks`（lint/typecheck/unit/build）と**並列**で
走る（unit ジョブを重くしない）。CI では `npx playwright install --with-deps chromium` で
Chromium を導入し、`npm run test:e2e`（webServer が build&start）で安定動線を検証する。
リポジトリ Secrets（`DATABASE_URL` 等）が登録されていればフルフローも実行される（未登録なら
空文字 → `test.skip` で安全にグリーン）。
