import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import { selectSearchHistory, selectViewHistory } from "./queries";

/**
 * 履歴取得クエリのテスト（PGlite・drizzle マイグレーション一式適用）。
 *
 * 主眼（DESIGN §6.2 / TASKS ⑤）:
 * - 本人分のみ返す（他人の履歴が漏れない＝user_id フィルタの検証）。
 * - 時系列降順（新しい順）。
 * - 閲覧履歴は銘柄＋蔵元を JOIN して SakeSummary を返す。
 *
 * profiles 行はトリガ（auth.users への INSERT → handle_new_user）で自動作成する
 * （schema.test.ts と同型のスタブ）。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BREWERY_ID = "c1111111-1111-4111-8111-111111111111";
const SAKE_1 = "d1111111-1111-4111-8111-111111111111";
const SAKE_2 = "d2222222-2222-4222-8222-222222222222";
const TAG_ID = "e1111111-1111-4111-8111-111111111111";

// 決定的な時刻（新しい順の検証用）。
const T1 = new Date("2026-07-01T00:00:00Z");
const T2 = new Date("2026-07-02T00:00:00Z");
const T3 = new Date("2026-07-03T00:00:00Z");

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

  // auth.users への INSERT でトリガが profiles を自動作成する（履歴 FK の足場）。
  await db.exec(
    `INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');`,
  );

  await orm.insert(schema.breweries).values({
    id: BREWERY_ID,
    name: "旭酒造",
    prefectureCode: "35",
  });
  await orm.insert(schema.sakes).values([
    { id: SAKE_1, breweryId: BREWERY_ID, name: "獺祭" },
    { id: SAKE_2, breweryId: BREWERY_ID, name: "獺祭 磨き" },
  ]);
  await orm
    .insert(schema.tags)
    .values({ id: TAG_ID, name: "華やか", category: "taste" });
  await orm
    .insert(schema.sakeTags)
    .values({ sakeId: SAKE_1, tagId: TAG_ID, source: "sakenowa" });

  // 閲覧履歴: USER_A は SAKE_1(T1) → SAKE_2(T2) → SAKE_1(T3) の 3 件（同一銘柄の複数回閲覧含む）。
  // USER_B は SAKE_2(T2) を 1 件（他人の履歴。USER_A のクエリに漏れないこと）。
  await orm.insert(schema.viewHistories).values([
    { userId: USER_A, sakeId: SAKE_1, viewedAt: T1 },
    { userId: USER_A, sakeId: SAKE_2, viewedAt: T2 },
    { userId: USER_A, sakeId: SAKE_1, viewedAt: T3 },
    { userId: USER_B, sakeId: SAKE_2, viewedAt: T2 },
  ]);

  // 検索履歴: USER_A 2 件（T1, T3）、USER_B 1 件（T2）。
  await orm.insert(schema.searchHistories).values([
    {
      userId: USER_A,
      query: "獺祭",
      filters: { prefectureCode: "35" },
      searchedAt: T1,
    },
    {
      userId: USER_A,
      query: null,
      filters: { tagNames: ["華やか"] },
      searchedAt: T3,
    },
    {
      userId: USER_B,
      query: "久保田",
      filters: {},
      searchedAt: T2,
    },
  ]);
});

describe("selectViewHistory", () => {
  it("本人分のみを新しい順に返す（他人の履歴が漏れない）", async () => {
    const page = await selectViewHistory(orm, USER_A);
    expect(page.total).toBe(3);
    expect(page.entries).toHaveLength(3);
    // T3(SAKE_1) → T2(SAKE_2) → T1(SAKE_1) の降順。
    expect(page.entries.map((e) => e.sake.id)).toEqual([
      SAKE_1,
      SAKE_2,
      SAKE_1,
    ]);
    expect(page.entries[0].viewedAt.getTime()).toBe(T3.getTime());
  });

  it("銘柄＋蔵元を JOIN し、タグ付きの SakeSummary を返す", async () => {
    const page = await selectViewHistory(orm, USER_A);
    const latest = page.entries[0];
    expect(latest.sake.name).toBe("獺祭");
    expect(latest.sake.breweryName).toBe("旭酒造");
    expect(latest.sake.prefectureCode).toBe("35");
    expect(latest.sake.tags.map((t) => t.name)).toContain("華やか");
  });

  it("別ユーザー（USER_B）には自分の 1 件だけが見える", async () => {
    const page = await selectViewHistory(orm, USER_B);
    expect(page.total).toBe(1);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].sake.id).toBe(SAKE_2);
  });
});

describe("selectSearchHistory", () => {
  it("本人分のみを新しい順に返す（他人の履歴が漏れない）", async () => {
    const page = await selectSearchHistory(orm, USER_A);
    expect(page.total).toBe(2);
    expect(page.entries).toHaveLength(2);
    // T3 → T1 の降順。
    expect(page.entries[0].searchedAt.getTime()).toBe(T3.getTime());
    expect(page.entries[0].filters).toEqual({ tagNames: ["華やか"] });
    expect(page.entries[1].query).toBe("獺祭");
    expect(page.entries[1].filters).toEqual({ prefectureCode: "35" });
  });

  it("別ユーザー（USER_B）には自分の 1 件だけが見える", async () => {
    const page = await selectSearchHistory(orm, USER_B);
    expect(page.total).toBe(1);
    expect(page.entries[0].query).toBe("久保田");
  });
});
