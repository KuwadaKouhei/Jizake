/**
 * E2E の実行環境フラグ（実データ/実キーの有無で skip 条件を分ける）。
 *
 * 自律実行モードの制約（TASKS T16・REVIEW 各タスク残作業）で、Supabase 実 DB と
 * AI Gateway キーが無い環境がある。その場合 DB/LLM に依存する画面は 500 になるため、
 * フルフロー spec を `test.skip(!hasDatabase)` / `test.skip(!hasAiGateway)` で条件付き
 * スキップし、DB/キー無しでも到達できる安定動線だけを常に検証する。
 *
 * ※ E2E は外部サーバを起動して叩く黒箱テストであり、これらの環境変数はサーバ側で参照される。
 *   ここでは「テストランナー（Playwright）を起動したシェルの環境変数」を見て skip を決める。
 *   webServer をこの設定から起動する場合、同じシェルの環境変数がサーバへ引き継がれるため、
 *   ランナー側の判定とサーバ側の実挙動が一致する。
 */

/** Supabase 実 DB（DATABASE_URL）が設定されているか。DB 依存画面のフルフローに必要。 */
export const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Supabase 認証（公開 URL＋anon key）が設定されているか。ログイン往復のフルフローに必要。 */
export const hasSupabaseAuth = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** AI Gateway キー（AI_GATEWAY_API_KEY）が設定されているか。チャット 1 往復のフルフローに必要。 */
export const hasAiGateway = Boolean(process.env.AI_GATEWAY_API_KEY);
