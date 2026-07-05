import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import {
  selectFavoriteSakes,
  selectIsFavorite,
  toggleFavoriteRow,
} from "./favorites";

/**
 * お気に入りクエリの統合テスト（PGlite）— T25 / FR-10。
 *
 * トグルの冪等性・一覧（新しい順・要約整形）・本人以外の行を混ぜない、を実 DB で確認する
 * （TEST_PHILOSOPHY: DB クエリは PGlite で検証）。
 */
const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

async function seedUser(id: string) {
  await orm.insert(schema.profiles).values({ id });
}

async function seedBrewery(name: string, prefectureCode: string) {
  const [row] = await orm
    .insert(schema.breweries)
    .values({ name, prefectureCode })
    .returning({ id: schema.breweries.id });
  return row.id;
}

async function seedSake(breweryId: string, name: string) {
  const [row] = await orm
    .insert(schema.sakes)
    .values({ breweryId, name })
    .returning({ id: schema.sakes.id });
  return row.id;
}

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
  // profiles → auth.users FK があるため auth.users にも入れておく。
  await db.exec(`
    INSERT INTO auth.users (id) VALUES
      ('${USER_A}'), ('${USER_B}');
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await orm.delete(schema.favorites);
  await orm.delete(schema.sakes);
  await orm.delete(schema.breweries);
  await orm.delete(schema.profiles);
  await seedUser(USER_A);
  await seedUser(USER_B);
});

describe("favorites クエリ（PGlite）", () => {
  it("トグルで追加→削除でき、状態が交互に変わる（冪等）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const sakeId = await seedSake(breweryId, "獺祭");

    expect(await selectIsFavorite(orm, USER_A, sakeId)).toBe(false);

    expect(await toggleFavoriteRow(orm, USER_A, sakeId)).toBe(true);
    expect(await selectIsFavorite(orm, USER_A, sakeId)).toBe(true);

    expect(await toggleFavoriteRow(orm, USER_A, sakeId)).toBe(false);
    expect(await selectIsFavorite(orm, USER_A, sakeId)).toBe(false);
  });

  it("不正な sakeId は false（DB へ触れない）", async () => {
    expect(await selectIsFavorite(orm, USER_A, "not-a-uuid")).toBe(false);
  });

  it("一覧は新しい順の SakeSummary（要約・タグ付き）で返る", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const older = await seedSake(breweryId, "古い方");
    const newer = await seedSake(breweryId, "新しい方");

    await toggleFavoriteRow(orm, USER_A, older);
    await toggleFavoriteRow(orm, USER_A, newer);

    const list = await selectFavoriteSakes(orm, USER_A);
    // created_at 降順（後から登録した newer が先頭）。
    expect(list.map((s) => s.id)).toEqual([newer, older]);
    expect(list[0].name).toBe("新しい方");
    expect(list[0].breweryName).toBe("旭酒造");
    expect(list[0].imageUrl).toBeNull();
  });

  it("他人のお気に入りは一覧に混ざらない（本人の user_id で絞る）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const mine = await seedSake(breweryId, "自分の");
    const theirs = await seedSake(breweryId, "他人の");

    await toggleFavoriteRow(orm, USER_A, mine);
    await toggleFavoriteRow(orm, USER_B, theirs);

    const list = await selectFavoriteSakes(orm, USER_A);
    expect(list.map((s) => s.id)).toEqual([mine]);
  });
});
