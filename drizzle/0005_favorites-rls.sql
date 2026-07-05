-- favorites の RLS（DATABASE.md §4.2・§2.11。T25 / FR-10）。
-- 他テーブルと同じ defense-in-depth: 本人の行のみ SELECT 可。書き込み（INSERT/DELETE）
-- ポリシーは意図的に作らない（お気に入りの追加/削除は RLS を素通しするサーバ接続経由の
-- Server Action のみ。user_id は必ず認証セッションから取得する。決定 DB-9 と同じ方針）。
ALTER TABLE "favorites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "favorites_own_select" ON "favorites"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
