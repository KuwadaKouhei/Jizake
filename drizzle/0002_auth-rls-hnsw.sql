-- カスタム SQL マイグレーション（DATABASE.md §1.5・§2.5・§3 index 10・§4.2）。
-- Drizzle スキーマ（src/lib/db/schema.ts）で表現できない Supabase 固有部分:
--   1. profiles.id → auth.users.id の FK（auth スキーマは Drizzle 管理外）
--   2. サインアップ時の profiles 自動作成トリガ
--   3. 全テーブルの RLS 有効化＋ポリシー（defense-in-depth。主防御はサーバ側 user_id フィルタ）
--   4. sake_embeddings の HNSW インデックス

-- ---------------------------------------------------------------------------
-- 1. profiles → auth.users FK（退会時に CASCADE でユーザーデータを全削除）
-- ---------------------------------------------------------------------------
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_id_auth_users_id_fk"
  FOREIGN KEY ("id") REFERENCES auth.users ("id") ON DELETE CASCADE;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. サインアップ時の profiles 自動作成トリガ（DATABASE.md §2.5）
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. RLS 有効化（全 10 テーブル）＋ポリシー（DATABASE.md §4.2）
--    ポリシーが無い操作はデフォルト拒否。書き込み系ポリシーは意図的に作らない
--    （書き込みは RLS を素通しするサーバ接続経由のみ。決定 DB-9）。
-- ---------------------------------------------------------------------------
ALTER TABLE "breweries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sakes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sake_tags" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "view_histories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "search_histories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chat_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sake_embeddings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- カタログ 4 テーブル: 未ログインでも閲覧可（公開読み取り）
CREATE POLICY "breweries_public_select" ON "breweries"
  FOR SELECT TO anon, authenticated USING (true);
--> statement-breakpoint
CREATE POLICY "sakes_public_select" ON "sakes"
  FOR SELECT TO anon, authenticated USING (true);
--> statement-breakpoint
CREATE POLICY "tags_public_select" ON "tags"
  FOR SELECT TO anon, authenticated USING (true);
--> statement-breakpoint
CREATE POLICY "sake_tags_public_select" ON "sake_tags"
  FOR SELECT TO anon, authenticated USING (true);
--> statement-breakpoint

-- sake_embeddings はポリシーなし（全拒否）: サーバ側 retriever 専用

-- 本人のみ読み取り（auth.uid() は initPlan 化のため (select auth.uid()) 形式で書く）
CREATE POLICY "profiles_own_select" ON "profiles"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
--> statement-breakpoint
CREATE POLICY "view_histories_own_select" ON "view_histories"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "search_histories_own_select" ON "search_histories"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "chat_sessions_own_select" ON "chat_sessions"
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY "chat_messages_own_select" ON "chat_messages"
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM chat_sessions s
      WHERE s.id = session_id AND s.user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. HNSW インデックス（cosine。既定パラメータ m=16, ef_construction=64。決定 DB-7）
-- ---------------------------------------------------------------------------
CREATE INDEX "sake_embeddings_embedding_idx" ON "sake_embeddings"
  USING hnsw ("embedding" vector_cosine_ops);
