CREATE TABLE "favorites" (
	"user_id" uuid NOT NULL,
	"sake_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_sake_id_pk" PRIMARY KEY("user_id","sake_id")
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_sake_id_sakes_id_fk" FOREIGN KEY ("sake_id") REFERENCES "public"."sakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favorites_user_id_created_at_idx" ON "favorites" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "favorites_sake_id_idx" ON "favorites" USING btree ("sake_id");