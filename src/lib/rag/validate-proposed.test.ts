import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import { selectExistingSakes } from "./validate-proposed";

/**
 * 捏造防止の DB 存在検証（validateProposedSakeIds）の統合テスト（TASKS T12 ②）。
 *
 * FR-08「提案は DB 実在の銘柄のみ／DB に無い銘柄を捏造して提案しない」の部品を
 * PGlite（実 Postgres）で検証する。LLM 非依存なので実 API は不要。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

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
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await orm.delete(schema.sakeTags);
  await orm.delete(schema.sakes);
  await orm.delete(schema.breweries);
  await orm.delete(schema.tags);
});

describe("selectExistingSakes（提案 ID の DB 存在検証）", () => {
  it("実在する ID のみ通し、存在しない ID は捨てる", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const real1 = await seedSake(breweryId, "獺祭");
    const real2 = await seedSake(breweryId, "獺祭 45");
    // 実在しないが UUID 書式は正しい ID
    const fake = "00000000-0000-4000-8000-000000000000";

    const result = await selectExistingSakes(orm, [real1, fake, real2]);
    expect(result.map((s) => s.id)).toEqual([real1, real2]);
    expect(result.every((s) => s.breweryName === "旭酒造")).toBe(true);
  });

  it("入力 ids の順序を保って返す（LLM の提案順を尊重）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const a = await seedSake(breweryId, "A");
    const b = await seedSake(breweryId, "B");
    const c = await seedSake(breweryId, "C");

    // 逆順で渡すと逆順で返る（DB の物理順ではなく入力順）
    const result = await selectExistingSakes(orm, [c, a, b]);
    expect(result.map((s) => s.id)).toEqual([c, a, b]);
  });

  it("UUID 書式でない不正な ID は DB を引かずに捨てる", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const real = await seedSake(breweryId, "獺祭");

    const result = await selectExistingSakes(orm, [
      "not-a-uuid",
      "'; DROP TABLE sakes; --",
      real,
    ]);
    expect(result.map((s) => s.id)).toEqual([real]);
  });

  it("重複 ID は 1 件に畳む（同じ銘柄の複数提案を 1 枚に）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const real = await seedSake(breweryId, "獺祭");

    const result = await selectExistingSakes(orm, [real, real, real]);
    expect(result.map((s) => s.id)).toEqual([real]);
  });

  it("空配列・全て存在しない ID は空配列を返す", async () => {
    expect(await selectExistingSakes(orm, [])).toEqual([]);
    expect(
      await selectExistingSakes(orm, ["11111111-1111-4111-8111-111111111111"]),
    ).toEqual([]);
  });

  it("提案銘柄はタグを含めて返す（カード表示用）", async () => {
    const breweryId = await seedBrewery("旭酒造", "35");
    const sakeId = await seedSake(breweryId, "獺祭");
    const [tag] = await orm
      .insert(schema.tags)
      .values({ name: "華やか", category: "taste" })
      .returning({ id: schema.tags.id });
    await orm
      .insert(schema.sakeTags)
      .values({ sakeId, tagId: tag.id, source: "sakenowa" });

    const [result] = await selectExistingSakes(orm, [sakeId]);
    expect(result.tags.map((t) => t.name)).toEqual(["華やか"]);
  });
});
