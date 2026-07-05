import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import { PRICE_RANGES } from "@/lib/constants/price-ranges";

/**
 * Drizzle スキーマ（10 テーブル）。DATABASE.md §2 の物理設計を単一情報源として写経する。
 *
 * DATABASE.md §1.5 のとおり、Drizzle で表現できないもの
 * （CREATE EXTENSION vector / RLS ポリシー / profiles 自動作成トリガ /
 * profiles.id → auth.users.id の FK / HNSW インデックス）は
 * drizzle/ 配下のカスタム SQL マイグレーションで定義する。
 */

// 価格帯 CHECK は src/lib/constants/price-ranges.ts を単一情報源として組み立てる
// （CHECK 制約はパラメータ化できないため sql.raw でリテラルに展開する）。
// sql.raw に展開する値は SQL リテラルとして安全な形式（小文字英数と _ のみ）に
// 限定し、将来の区分追加でクォート等が紛れ込んだら即座に失敗させる
// （T02 レビュー Consider の引き継ぎ対応）。
const SQL_LITERAL_SAFE_PATTERN = /^[a-z0-9_]+$/;
for (const range of PRICE_RANGES) {
  if (!SQL_LITERAL_SAFE_PATTERN.test(range.value)) {
    throw new Error(
      `price-ranges.ts の value "${range.value}" は sql.raw へ展開できない形式です（許容: ${SQL_LITERAL_SAFE_PATTERN}）`,
    );
  }
}
const priceRangeList = sql.raw(
  PRICE_RANGES.map((range) => `'${range.value}'`).join(", "),
);

// ---------------------------------------------------------------------------
// breweries（蔵元）— DATABASE.md §2.1
// ---------------------------------------------------------------------------
export const breweries = pgTable(
  "breweries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // さけのわ breweryId（自然キー）。手作業追加の蔵元は NULL
    sakenowaBreweryId: integer("sakenowa_brewery_id").unique(),
    name: text("name").notNull(),
    // JIS 都道府県コード 2 桁
    prefectureCode: text("prefecture_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 手作業シードの冪等 upsert キー兼、重複登録防止
    unique("breweries_name_prefecture_code_unique").on(
      t.name,
      t.prefectureCode,
    ),
    check(
      "breweries_prefecture_code_check",
      sql`${t.prefectureCode} ~ '^(0[1-9]|[1-3][0-9]|4[0-7])$'`,
    ),
    // index 1: 県別一覧・検索の都道府県条件（DATABASE.md §3）
    index("breweries_prefecture_code_idx").on(t.prefectureCode),
  ],
);

// ---------------------------------------------------------------------------
// sakes（日本酒）— DATABASE.md §2.2
// ---------------------------------------------------------------------------
export const sakes = pgTable(
  "sakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // さけのわ brandId（自然キー）。手作業銘柄は NULL
    sakenowaBrandId: integer("sakenowa_brand_id").unique(),
    breweryId: uuid("brewery_id")
      .notNull()
      // 銘柄が残る限り蔵元は消せない
      .references(() => breweries.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // 読み仮名（ひらがな）。ILIKE 検索の表記ゆれ対策
    reading: text("reading"),
    // 自作説明文（RAG 埋め込みの原文）
    description: text("description"),
    officialUrl: text("official_url"),
    amazonUrl: text("amazon_url"),
    rakutenUrl: text("rakuten_url"),
    // 銘柄画像 URL（楽天市場 API 由来の楽天 CDN URL。FR-09）。NULL=画像なし表示
    imageUrl: text("image_url"),
    // 価格帯 3 区分（src/lib/constants/price-ranges.ts と CHECK で同期）
    priceRange: text("price_range"),
    // さけのわ全国ランキング順位。推薦コールドスタートのフォールバック
    popularityRank: integer("popularity_rank"),
    // フレーバー 6 軸（0..1）。「全部ある」か「全部ない」のどちらかのみ
    flavorFloral: real("flavor_floral"),
    flavorMellow: real("flavor_mellow"),
    flavorHeavy: real("flavor_heavy"),
    flavorMild: real("flavor_mild"),
    flavorDry: real("flavor_dry"),
    flavorLight: real("flavor_light"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 手作業シードの upsert キー兼、同一蔵元内の重複銘柄防止
    unique("sakes_brewery_id_name_unique").on(t.breweryId, t.name),
    check(
      "sakes_price_range_check",
      sql`${t.priceRange} in (${priceRangeList})`,
    ),
    check("sakes_popularity_rank_check", sql`${t.popularityRank} > 0`),
    check("sakes_flavor_floral_check", sql`${t.flavorFloral} between 0 and 1`),
    check("sakes_flavor_mellow_check", sql`${t.flavorMellow} between 0 and 1`),
    check("sakes_flavor_heavy_check", sql`${t.flavorHeavy} between 0 and 1`),
    check("sakes_flavor_mild_check", sql`${t.flavorMild} between 0 and 1`),
    check("sakes_flavor_dry_check", sql`${t.flavorDry} between 0 and 1`),
    check("sakes_flavor_light_check", sql`${t.flavorLight} between 0 and 1`),
    // 6 軸は全有 or 全無のみ（さけのわ flavor-charts の提供単位と一致）
    check(
      "sakes_flavor_all_or_none_check",
      sql`num_nulls(${t.flavorFloral}, ${t.flavorMellow}, ${t.flavorHeavy}, ${t.flavorMild}, ${t.flavorDry}, ${t.flavorLight}) in (0, 6)`,
    ),
    // index 2: 蔵元 JOIN（DATABASE.md §3）
    index("sakes_brewery_id_idx").on(t.breweryId),
    // index 3: 人気順フォールバック用の部分インデックス
    index("sakes_popularity_rank_idx")
      .on(t.popularityRank)
      .where(sql`popularity_rank is not null`),
  ],
);

// ---------------------------------------------------------------------------
// tags（タグ）— DATABASE.md §2.3
// ---------------------------------------------------------------------------
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // カテゴリ跨ぎの同名タグは許さない（決定 DB-10）
    name: text("name").notNull().unique(),
    // taste=味わい、type=種別
    category: text("category").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("tags_category_check", sql`${t.category} in ('taste', 'type')`),
  ],
);

// ---------------------------------------------------------------------------
// sake_tags（日本酒⇔タグ 中間テーブル）— DATABASE.md §2.4
// ---------------------------------------------------------------------------
export const sakeTags = pgTable(
  "sake_tags",
  {
    sakeId: uuid("sake_id")
      .notNull()
      .references(() => sakes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    // 付与元の区別。再インポートは source='sakenowa' のみ入れ替え、manual を保全
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sakeId, t.tagId] }),
    check("sake_tags_source_check", sql`${t.source} in ('sakenowa', 'manual')`),
    // index 4: タグ→日本酒の逆引き。sake_id 起点は複合 PK が兼ねる
    index("sake_tags_tag_id_idx").on(t.tagId),
  ],
);

// ---------------------------------------------------------------------------
// profiles（プロフィール）— DATABASE.md §2.5
// auth.users と 1:1 の公開スキーマ側アンカー。
// id → auth.users.id の FK と自動作成トリガはカスタム SQL マイグレーションで定義
// （Drizzle 管理外の auth スキーマへの参照のため）。
// ---------------------------------------------------------------------------
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// view_histories（閲覧履歴）— DATABASE.md §2.6（追記専用）
// ---------------------------------------------------------------------------
export const viewHistories = pgTable(
  "view_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sakeId: uuid("sake_id")
      .notNull()
      .references(() => sakes.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // index 5: 履歴一覧・推薦の「直近 N 件」集計
    index("view_histories_user_id_viewed_at_idx").on(
      t.userId,
      t.viewedAt.desc(),
    ),
    // index 6: 銘柄削除時の CASCADE 走査・銘柄別集計
    index("view_histories_sake_id_idx").on(t.sakeId),
  ],
);

// ---------------------------------------------------------------------------
// search_histories（検索履歴）— DATABASE.md §2.7（追記専用）
// ---------------------------------------------------------------------------
export const searchHistories = pgTable(
  "search_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // 名前検索文字列。名前条件なしの検索では NULL
    query: text("query"),
    // 検索条件のスナップショット（Zod SearchParams と同形）。意図的な非正規化（決定 DB-5）
    filters: jsonb("filters")
      .notNull()
      .default(sql`'{}'::jsonb`),
    searchedAt: timestamp("searched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 条件が完全に空の「検索」は記録させない
    check(
      "search_histories_not_empty_check",
      sql`${t.query} is not null or ${t.filters} <> '{}'::jsonb`,
    ),
    // index 7: 履歴一覧・推薦集計
    index("search_histories_user_id_searched_at_idx").on(
      t.userId,
      t.searchedAt.desc(),
    ),
  ],
);

// ---------------------------------------------------------------------------
// chat_sessions（チャットセッション）— DATABASE.md §2.8
// ログインユーザーが確定提案を受けた会話のみ保存（決定 D4）
// ---------------------------------------------------------------------------
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // index 8: 本人のセッション一覧・1日あたりチャット回数カウント（レート制限）
    index("chat_sessions_user_id_created_at_idx").on(
      t.userId,
      t.createdAt.desc(),
    ),
  ],
);

// ---------------------------------------------------------------------------
// chat_messages（チャットメッセージ）— DATABASE.md §2.9
// ---------------------------------------------------------------------------
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    // DB 存在検証済みの提案銘柄 ID 配列。意図的な非正規化（決定 DB-6）
    proposedSakeIds: uuid("proposed_sake_ids").array(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("chat_messages_role_check", sql`${t.role} in ('user', 'assistant')`),
    // 提案 ID は assistant メッセージにのみ付く
    check(
      "chat_messages_proposed_role_check",
      sql`${t.proposedSakeIds} is null or ${t.role} = 'assistant'`,
    ),
    // index 9: セッション内メッセージの時系列取得
    index("chat_messages_session_id_created_at_idx").on(
      t.sessionId,
      t.createdAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// sake_embeddings（埋め込み）— DATABASE.md §2.10
// 前提: create extension vector（カスタム SQL マイグレーション）。
// HNSW インデックスもカスタム SQL で定義する（DATABASE.md §1.5・§3 index 10）。
// ---------------------------------------------------------------------------
export const sakeEmbeddings = pgTable("sake_embeddings", {
  sakeId: uuid("sake_id")
    .primaryKey()
    .references(() => sakes.id, { onDelete: "cascade" }),
  // text-embedding-3-small の 1536 次元
  embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  // 埋め込みモデル名。モデル差し替え時の再生成対象判定
  model: text("model").notNull(),
  // 説明文の SHA-256（hex）。embed.ts の差分再埋め込み判定
  sourceHash: text("source_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// 型エクスポート（スキーマを型の単一情報源とする）
// ---------------------------------------------------------------------------
export type Brewery = typeof breweries.$inferSelect;
export type NewBrewery = typeof breweries.$inferInsert;
export type Sake = typeof sakes.$inferSelect;
export type NewSake = typeof sakes.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type SakeTag = typeof sakeTags.$inferSelect;
export type NewSakeTag = typeof sakeTags.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type ViewHistory = typeof viewHistories.$inferSelect;
export type NewViewHistory = typeof viewHistories.$inferInsert;
export type SearchHistory = typeof searchHistories.$inferSelect;
export type NewSearchHistory = typeof searchHistories.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type SakeEmbedding = typeof sakeEmbeddings.$inferSelect;
export type NewSakeEmbedding = typeof sakeEmbeddings.$inferInsert;
