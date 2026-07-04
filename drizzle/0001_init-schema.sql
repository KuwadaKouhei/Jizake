CREATE TABLE "breweries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sakenowa_brewery_id" integer,
	"name" text NOT NULL,
	"prefecture_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "breweries_sakenowa_brewery_id_unique" UNIQUE("sakenowa_brewery_id"),
	CONSTRAINT "breweries_name_prefecture_code_unique" UNIQUE("name","prefecture_code"),
	CONSTRAINT "breweries_prefecture_code_check" CHECK ("breweries"."prefecture_code" ~ '^(0[1-9]|[1-3][0-9]|4[0-7])$')
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"proposed_sake_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_role_check" CHECK ("chat_messages"."role" in ('user', 'assistant')),
	CONSTRAINT "chat_messages_proposed_role_check" CHECK ("chat_messages"."proposed_sake_ids" is null or "chat_messages"."role" = 'assistant')
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sake_embeddings" (
	"sake_id" uuid PRIMARY KEY NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text NOT NULL,
	"source_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sake_tags" (
	"sake_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sake_tags_sake_id_tag_id_pk" PRIMARY KEY("sake_id","tag_id"),
	CONSTRAINT "sake_tags_source_check" CHECK ("sake_tags"."source" in ('sakenowa', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "sakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sakenowa_brand_id" integer,
	"brewery_id" uuid NOT NULL,
	"name" text NOT NULL,
	"reading" text,
	"description" text,
	"official_url" text,
	"amazon_url" text,
	"rakuten_url" text,
	"price_range" text,
	"popularity_rank" integer,
	"flavor_floral" real,
	"flavor_mellow" real,
	"flavor_heavy" real,
	"flavor_mild" real,
	"flavor_dry" real,
	"flavor_light" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sakes_sakenowa_brand_id_unique" UNIQUE("sakenowa_brand_id"),
	CONSTRAINT "sakes_brewery_id_name_unique" UNIQUE("brewery_id","name"),
	CONSTRAINT "sakes_price_range_check" CHECK ("sakes"."price_range" in ('under_1500', 'from_1500_to_3000', 'over_3000')),
	CONSTRAINT "sakes_popularity_rank_check" CHECK ("sakes"."popularity_rank" > 0),
	CONSTRAINT "sakes_flavor_floral_check" CHECK ("sakes"."flavor_floral" between 0 and 1),
	CONSTRAINT "sakes_flavor_mellow_check" CHECK ("sakes"."flavor_mellow" between 0 and 1),
	CONSTRAINT "sakes_flavor_heavy_check" CHECK ("sakes"."flavor_heavy" between 0 and 1),
	CONSTRAINT "sakes_flavor_mild_check" CHECK ("sakes"."flavor_mild" between 0 and 1),
	CONSTRAINT "sakes_flavor_dry_check" CHECK ("sakes"."flavor_dry" between 0 and 1),
	CONSTRAINT "sakes_flavor_light_check" CHECK ("sakes"."flavor_light" between 0 and 1),
	CONSTRAINT "sakes_flavor_all_or_none_check" CHECK (num_nulls("sakes"."flavor_floral", "sakes"."flavor_mellow", "sakes"."flavor_heavy", "sakes"."flavor_mild", "sakes"."flavor_dry", "sakes"."flavor_light") in (0, 6))
);
--> statement-breakpoint
CREATE TABLE "search_histories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_histories_not_empty_check" CHECK ("search_histories"."query" is not null or "search_histories"."filters" <> '{}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name"),
	CONSTRAINT "tags_category_check" CHECK ("tags"."category" in ('taste', 'type'))
);
--> statement-breakpoint
CREATE TABLE "view_histories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sake_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sake_embeddings" ADD CONSTRAINT "sake_embeddings_sake_id_sakes_id_fk" FOREIGN KEY ("sake_id") REFERENCES "public"."sakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sake_tags" ADD CONSTRAINT "sake_tags_sake_id_sakes_id_fk" FOREIGN KEY ("sake_id") REFERENCES "public"."sakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sake_tags" ADD CONSTRAINT "sake_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sakes" ADD CONSTRAINT "sakes_brewery_id_breweries_id_fk" FOREIGN KEY ("brewery_id") REFERENCES "public"."breweries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_histories" ADD CONSTRAINT "search_histories_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_histories" ADD CONSTRAINT "view_histories_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_histories" ADD CONSTRAINT "view_histories_sake_id_sakes_id_fk" FOREIGN KEY ("sake_id") REFERENCES "public"."sakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "breweries_prefecture_code_idx" ON "breweries" USING btree ("prefecture_code");--> statement-breakpoint
CREATE INDEX "chat_messages_session_id_created_at_idx" ON "chat_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_sessions_user_id_created_at_idx" ON "chat_sessions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sake_tags_tag_id_idx" ON "sake_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "sakes_brewery_id_idx" ON "sakes" USING btree ("brewery_id");--> statement-breakpoint
CREATE INDEX "sakes_popularity_rank_idx" ON "sakes" USING btree ("popularity_rank") WHERE popularity_rank is not null;--> statement-breakpoint
CREATE INDEX "search_histories_user_id_searched_at_idx" ON "search_histories" USING btree ("user_id","searched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "view_histories_user_id_viewed_at_idx" ON "view_histories" USING btree ("user_id","viewed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "view_histories_sake_id_idx" ON "view_histories" USING btree ("sake_id");