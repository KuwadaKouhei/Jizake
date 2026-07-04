import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import { selectTagsByCategory } from "./tags";

/**
 * タグ候補クエリのテスト。PGlite（マイグレーション一式適用）で
 * カテゴリ絞り込み・name 昇順を検証する（TEST_PHILOSOPHY: テスト DB は PGlite）。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

const TASTE_KARA = "f1111111-1111-4111-8111-111111111111";
const TASTE_TANREI = "f2222222-2222-4222-8222-222222222222";
const TYPE_JUNMAI = "f3333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await migrate(orm, { migrationsFolder: "drizzle" });

  await orm.insert(schema.tags).values([
    // name 昇順の検証のため、投入順を昇順と逆にする（淡麗→辛口）。
    { id: TASTE_TANREI, name: "淡麗", category: "taste" },
    { id: TASTE_KARA, name: "辛口", category: "taste" },
    { id: TYPE_JUNMAI, name: "純米大吟醸", category: "type" },
  ]);
});

afterAll(async () => {
  await db.close();
});

describe("selectTagsByCategory", () => {
  it("味タグ（taste）のみを name 昇順で返す（種別タグは混ざらない）", async () => {
    const options = await selectTagsByCategory(orm, "taste");
    // Postgres の text 昇順はコードポイント順（淡 U+6DE1 < 辛 U+8F9B）。
    expect(options).toEqual([
      { id: TASTE_TANREI, name: "淡麗", category: "taste" },
      { id: TASTE_KARA, name: "辛口", category: "taste" },
    ]);
  });

  it("種別タグ（type）は type カテゴリでのみ返る", async () => {
    const options = await selectTagsByCategory(orm, "type");
    expect(options).toEqual([
      { id: TYPE_JUNMAI, name: "純米大吟醸", category: "type" },
    ]);
  });

  it("該当タグがないカテゴリは空配列", async () => {
    // CHECK 制約外の値でも SELECT は空を返す（絞り込みのみ検証）。
    expect(await selectTagsByCategory(orm, "unknown")).toEqual([]);
  });
});
