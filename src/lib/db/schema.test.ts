import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PRICE_RANGES } from "@/lib/constants/price-ranges";

import * as schema from "./schema";

/**
 * スキーマ検証テスト（PGlite = インプロセス Postgres）。
 *
 * drizzle/ のマイグレーション一式（vector 拡張 → 10 テーブル → カスタム SQL）が
 * 適用でき、DATABASE.md §2〜§4 の制約・トリガ・インデックスが再現されることを検証する。
 *
 * 【テスト対象外（Supabase 固有のため PGlite で再現できない部分）】
 * - auth スキーマの実体: Supabase Auth が管理する auth.users / auth.uid() は
 *   ここでは最小限のスタブで代替する。実際のサインアップフローとの結合は
 *   T08（認証）以降に実環境で確認する。
 * - RLS の実効確認: anon / authenticated ロールでの実クエリ遮断は PostgREST +
 *   実ロール接続が前提のため、ここでは「RLS が有効化されていること」
 *   「ポリシー定義が存在すること」の DDL 検証に留める。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

// テスト全体で使うスタブユーザー（auth.users へ INSERT → トリガで profiles 自動作成）
const stubUserId = "00000000-0000-4000-8000-000000000001";

/**
 * DB エラーの検査ヘルパー。
 * drizzle-orm は DB エラーを DrizzleQueryError でラップし、制約名は cause 側の
 * メッセージに入るため、エラー連鎖全体を結合してからパターン照合する。
 */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, "クエリが失敗すること").toBeInstanceOf(Error);
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join("\n")).toMatch(pattern);
}

async function createBrewery(name: string, prefectureCode = "35") {
  const [row] = await orm
    .insert(schema.breweries)
    .values({ name, prefectureCode })
    .returning();
  return row;
}

async function createSake(breweryId: string, name: string) {
  const [row] = await orm
    .insert(schema.sakes)
    .values({ breweryId, name })
    .returning();
  return row;
}

beforeAll(async () => {
  // --- Supabase 環境のスタブ（冒頭コメント参照） ---
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);

  // マイグレーション一式を適用（drizzle/ の journal 順 = 本番適用と同一手順）
  await migrate(orm, { migrationsFolder: "drizzle" });

  await db.exec(`INSERT INTO auth.users (id) VALUES ('${stubUserId}');`);
});

afterAll(async () => {
  await db.close();
});

describe("マイグレーション適用結果", () => {
  it("11 テーブルがすべて public スキーマに作成される", async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const tableNames = result.rows.map((r) => r.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        "breweries",
        "sakes",
        "tags",
        "sake_tags",
        "profiles",
        "view_histories",
        "search_histories",
        "chat_sessions",
        "chat_messages",
        "sake_embeddings",
        "favorites",
      ]),
    );
  });

  it("DATABASE.md §3 のインデックス（1〜9）と HNSW（10）が作成される", async () => {
    const result = await db.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const indexes = new Map(result.rows.map((r) => [r.indexname, r.indexdef]));

    for (const name of [
      "breweries_prefecture_code_idx",
      "sakes_brewery_id_idx",
      "sakes_popularity_rank_idx",
      "sake_tags_tag_id_idx",
      "view_histories_user_id_viewed_at_idx",
      "view_histories_sake_id_idx",
      "search_histories_user_id_searched_at_idx",
      "chat_sessions_user_id_created_at_idx",
      "chat_messages_session_id_created_at_idx",
      "sake_embeddings_embedding_idx",
    ]) {
      expect(indexes.has(name), `${name} が存在すること`).toBe(true);
    }

    // index 3 は部分インデックス、index 10 は HNSW（cosine）
    expect(indexes.get("sakes_popularity_rank_idx")).toMatch(
      /WHERE.*popularity_rank IS NOT NULL/i,
    );
    expect(indexes.get("sake_embeddings_embedding_idx")).toMatch(
      /USING hnsw.*vector_cosine_ops/,
    );
  });
});

describe("breweries の制約", () => {
  it("prefecture_code は JIS コード（01〜47）のみ受け付ける", async () => {
    await expect(createBrewery("獺祭の蔵", "35")).resolves.toBeDefined();
    await expect(createBrewery("北端の蔵", "01")).resolves.toBeDefined();
    await expect(createBrewery("南端の蔵", "47")).resolves.toBeDefined();

    for (const invalid of ["00", "48", "1", "ab"]) {
      await expectDbError(
        createBrewery(`不正コードの蔵-${invalid}`, invalid),
        /breweries_prefecture_code_check/,
      );
    }
  });

  it("(name, prefecture_code) は UNIQUE（手作業シードの upsert キー）", async () => {
    await createBrewery("重複検証の蔵", "13");
    await expectDbError(
      createBrewery("重複検証の蔵", "13"),
      /breweries_name_prefecture_code_unique/,
    );
    // 同名でも県が違えば登録できる
    await expect(createBrewery("重複検証の蔵", "14")).resolves.toBeDefined();
  });

  it("sakenowa_brewery_id は UNIQUE（冪等 upsert キー）", async () => {
    await orm.insert(schema.breweries).values({
      name: "さけのわの蔵A",
      prefectureCode: "02",
      sakenowaBreweryId: 100,
    });
    await expectDbError(
      orm.insert(schema.breweries).values({
        name: "さけのわの蔵B",
        prefectureCode: "03",
        sakenowaBreweryId: 100,
      }),
      /breweries_sakenowa_brewery_id_unique/,
    );
  });
});

describe("sakes の制約", () => {
  it("price_range CHECK は price-ranges.ts の全区分を受け付け、他は拒否する", async () => {
    const brewery = await createBrewery("価格帯検証の蔵");
    for (const range of PRICE_RANGES) {
      await expect(
        orm.insert(schema.sakes).values({
          breweryId: brewery.id,
          name: `価格帯 ${range.value}`,
          priceRange: range.value,
        }),
      ).resolves.toBeDefined();
    }
    await expectDbError(
      orm.insert(schema.sakes).values({
        breweryId: brewery.id,
        name: "不正な価格帯",
        priceRange: "luxury",
      }),
      /sakes_price_range_check/,
    );
  });

  it("price_range CHECK の許容値集合が price-ranges.ts と完全一致する", async () => {
    // 機能テスト（上）は「定数が全部通る」ことしか保証しないため、
    // 制約定義そのものを読み出して過不足がないことを突き合わせる
    const result = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'sakes_price_range_check'`,
    );
    const literals = [...result.rows[0].def.matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(new Set(literals)).toEqual(
      new Set(PRICE_RANGES.map((range) => range.value)),
    );
  });

  it("popularity_rank は正の整数のみ", async () => {
    const brewery = await createBrewery("ランク検証の蔵");
    await expectDbError(
      orm.insert(schema.sakes).values({
        breweryId: brewery.id,
        name: "ランク0",
        popularityRank: 0,
      }),
      /sakes_popularity_rank_check/,
    );
  });

  it("フレーバー6軸は 0..1 の範囲チェックを持つ", async () => {
    const brewery = await createBrewery("フレーバー範囲検証の蔵");
    await expectDbError(
      orm.insert(schema.sakes).values({
        breweryId: brewery.id,
        name: "範囲外フレーバー",
        flavorFloral: 1.5,
        flavorMellow: 0.5,
        flavorHeavy: 0.5,
        flavorMild: 0.5,
        flavorDry: 0.5,
        flavorLight: 0.5,
      }),
      /sakes_flavor_floral_check/,
    );
  });

  it("フレーバー6軸は「全部ある」か「全部ない」のみ", async () => {
    const brewery = await createBrewery("フレーバー全有無検証の蔵");
    await expect(
      orm.insert(schema.sakes).values({
        breweryId: brewery.id,
        name: "全軸あり",
        flavorFloral: 0.1,
        flavorMellow: 0.2,
        flavorHeavy: 0.3,
        flavorMild: 0.4,
        flavorDry: 0.5,
        flavorLight: 0.6,
      }),
    ).resolves.toBeDefined();
    await expect(
      orm
        .insert(schema.sakes)
        .values({ breweryId: brewery.id, name: "全軸なし" }),
    ).resolves.toBeDefined();
    await expectDbError(
      orm.insert(schema.sakes).values({
        breweryId: brewery.id,
        name: "一部欠け",
        flavorFloral: 0.1,
      }),
      /sakes_flavor_all_or_none_check/,
    );
  });

  it("(brewery_id, name) と sakenowa_brand_id は UNIQUE（冪等 upsert キー）", async () => {
    const brewery = await createBrewery("銘柄重複検証の蔵");
    await createSake(brewery.id, "重複銘柄");
    await expectDbError(
      createSake(brewery.id, "重複銘柄"),
      /sakes_brewery_id_name_unique/,
    );

    await orm.insert(schema.sakes).values({
      breweryId: brewery.id,
      name: "さけのわ銘柄A",
      sakenowaBrandId: 200,
    });
    await expectDbError(
      orm.insert(schema.sakes).values({
        breweryId: brewery.id,
        name: "さけのわ銘柄B",
        sakenowaBrandId: 200,
      }),
      /sakes_sakenowa_brand_id_unique/,
    );
  });

  it("銘柄が残る蔵元は削除できない（ON DELETE RESTRICT）", async () => {
    const brewery = await createBrewery("削除制限検証の蔵");
    await createSake(brewery.id, "残存銘柄");
    await expectDbError(
      orm.delete(schema.breweries).where(sql`id = ${brewery.id}`),
      /sakes_brewery_id_breweries_id_fk/,
    );
  });
});

describe("tags / sake_tags の制約", () => {
  it("tags.name は UNIQUE・category は taste / type のみ", async () => {
    await orm.insert(schema.tags).values({ name: "辛口", category: "taste" });
    await expectDbError(
      orm.insert(schema.tags).values({ name: "辛口", category: "type" }),
      /tags_name_unique/,
    );
    await expectDbError(
      orm.insert(schema.tags).values({ name: "料理相性", category: "pairing" }),
      /tags_category_check/,
    );
  });

  it("sake_tags は複合 PK・source は sakenowa / manual のみ・銘柄削除で CASCADE", async () => {
    const brewery = await createBrewery("タグ検証の蔵");
    const sake = await createSake(brewery.id, "タグ検証銘柄");
    const [tag] = await orm
      .insert(schema.tags)
      .values({ name: "淡麗", category: "taste" })
      .returning();

    await orm
      .insert(schema.sakeTags)
      .values({ sakeId: sake.id, tagId: tag.id, source: "sakenowa" });
    await expectDbError(
      orm
        .insert(schema.sakeTags)
        .values({ sakeId: sake.id, tagId: tag.id, source: "manual" }),
      /sake_tags_sake_id_tag_id_pk/,
    );
    await expectDbError(
      orm
        .insert(schema.sakeTags)
        .values({ sakeId: sake.id, tagId: tag.id, source: "auto" }),
      /sake_tags_source_check/,
    );

    await orm.delete(schema.sakes).where(sql`id = ${sake.id}`);
    const remaining = await orm
      .select()
      .from(schema.sakeTags)
      .where(sql`sake_id = ${sake.id}`);
    expect(remaining).toHaveLength(0);
  });
});

describe("profiles 自動作成トリガ（auth.users スタブ経由）", () => {
  it("auth.users への INSERT で profiles 行が自動作成される", async () => {
    const profiles = await orm
      .select()
      .from(schema.profiles)
      .where(sql`id = ${stubUserId}`);
    expect(profiles).toHaveLength(1);
  });

  it("auth.users の削除で profiles と履歴が CASCADE 削除される（退会フロー）", async () => {
    const userId = "00000000-0000-4000-8000-000000000002";
    await db.exec(`INSERT INTO auth.users (id) VALUES ('${userId}');`);

    const brewery = await createBrewery("退会検証の蔵");
    const sake = await createSake(brewery.id, "退会検証銘柄");
    await orm.insert(schema.viewHistories).values({ userId, sakeId: sake.id });

    await db.exec(`DELETE FROM auth.users WHERE id = '${userId}';`);
    const profiles = await orm
      .select()
      .from(schema.profiles)
      .where(sql`id = ${userId}`);
    const histories = await orm
      .select()
      .from(schema.viewHistories)
      .where(sql`user_id = ${userId}`);
    expect(profiles).toHaveLength(0);
    expect(histories).toHaveLength(0);
  });
});

describe("履歴・チャットの制約", () => {
  it("search_histories は条件が完全に空の記録を拒否する", async () => {
    await expectDbError(
      orm.insert(schema.searchHistories).values({ userId: stubUserId }),
      /search_histories_not_empty_check/,
    );
    await expect(
      orm
        .insert(schema.searchHistories)
        .values({ userId: stubUserId, query: "獺祭" }),
    ).resolves.toBeDefined();
    await expect(
      orm.insert(schema.searchHistories).values({
        userId: stubUserId,
        filters: { prefectureCode: "35", tagNames: ["辛口"] },
      }),
    ).resolves.toBeDefined();
  });

  it("chat_messages の role は user / assistant のみ・提案 ID は assistant 限定", async () => {
    const [session] = await orm
      .insert(schema.chatSessions)
      .values({ userId: stubUserId })
      .returning();

    await expectDbError(
      orm.insert(schema.chatMessages).values({
        sessionId: session.id,
        role: "system",
        content: "不正ロール",
      }),
      /chat_messages_role_check/,
    );

    const brewery = await createBrewery("チャット検証の蔵");
    const sake = await createSake(brewery.id, "チャット検証銘柄");
    await expectDbError(
      orm.insert(schema.chatMessages).values({
        sessionId: session.id,
        role: "user",
        content: "user に提案 ID は付けられない",
        proposedSakeIds: [sake.id],
      }),
      /chat_messages_proposed_role_check/,
    );
    await expect(
      orm.insert(schema.chatMessages).values({
        sessionId: session.id,
        role: "assistant",
        content: "こちらはいかがでしょう",
        proposedSakeIds: [sake.id],
      }),
    ).resolves.toBeDefined();
  });
});

describe("sake_embeddings", () => {
  it("vector(1536) の埋め込みを保存でき、次元違いは拒否される", async () => {
    const brewery = await createBrewery("埋め込み検証の蔵");
    const sake = await createSake(brewery.id, "埋め込み検証銘柄");

    await expect(
      orm.insert(schema.sakeEmbeddings).values({
        sakeId: sake.id,
        embedding: Array.from({ length: 1536 }, () => 0),
        model: "text-embedding-3-small",
        sourceHash: "a".repeat(64),
      }),
    ).resolves.toBeDefined();

    const other = await createSake(brewery.id, "次元違い銘柄");
    await expectDbError(
      orm.insert(schema.sakeEmbeddings).values({
        sakeId: other.id,
        embedding: [0, 1, 2],
        model: "text-embedding-3-small",
        sourceHash: "b".repeat(64),
      }),
      /expected 1536 dimensions/,
    );
  });
});

describe("RLS（DDL 検証のみ。実効確認はテスト対象外 — 冒頭コメント参照）", () => {
  it("全 11 テーブルで RLS が有効化されている", async () => {
    const result = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    const insecure = result.rows
      .filter((r) => !r.relrowsecurity)
      .map((r) => r.relname);
    expect(insecure).toEqual([]);
    expect(result.rows).toHaveLength(11);
  });

  it("DATABASE.md §4.2 のポリシーが定義され、書き込みポリシーは存在しない", async () => {
    const result = await db.query<{
      tablename: string;
      policyname: string;
      cmd: string;
    }>(
      `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public'`,
    );

    // SELECT ポリシーのみ（書き込み系はデフォルト拒否を利用。決定 DB-9）
    expect(result.rows.every((r) => r.cmd === "SELECT")).toBe(true);

    const byTable = new Map<string, number>();
    for (const row of result.rows) {
      byTable.set(row.tablename, (byTable.get(row.tablename) ?? 0) + 1);
    }
    // 公開読み取り 4 + 本人限定 6 = 計 10 テーブルに 1 ポリシーずつ
    for (const table of [
      "breweries",
      "sakes",
      "tags",
      "sake_tags",
      "profiles",
      "view_histories",
      "search_histories",
      "chat_sessions",
      "chat_messages",
      "favorites",
    ]) {
      expect(byTable.get(table), `${table} のポリシー数`).toBe(1);
    }
    // sake_embeddings はポリシーなし（全拒否）
    expect(byTable.has("sake_embeddings")).toBe(false);
  });
});
