import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import { recommendRuleBased, type RuleBasedConfig } from "./rule-based";

/**
 * ルールベース推薦の統合テスト（PGlite・drizzle マイグレーション一式適用）。
 *
 * 検証（TASKS ③ / DESIGN §2.5）:
 * - 履歴ありユーザーは嗜好（タグ・都道府県）に合う未閲覧銘柄が上位・閲覧済みは出ない。
 * - コールドスタート（未ログイン／履歴しきい値未満）は人気ランキング（popularity_rank）。
 * - limit 件数を守る。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

const USER_ACTIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_SPARSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const BREWERY_YAMAGUCHI = "c1111111-1111-4111-8111-111111111111";
const BREWERY_NIIGATA = "c2222222-2222-4222-8222-222222222222";

// 山口（35）の銘柄。辛口・淡麗タグを持つ嗜好一致銘柄群。
const SAKE_VIEWED = "d0000000-0000-4000-8000-000000000000"; // 閲覧済み（除外対象）
const SAKE_MATCH_STRONG = "d1111111-1111-4111-8111-111111111111"; // 辛口＋淡麗＋山口
const SAKE_MATCH_WEAK = "d2222222-2222-4222-8222-222222222222"; // 辛口のみ
// 新潟（15）・無関係タグの銘柄（嗜好に合わない＝スコア対象外）。
const SAKE_NOMATCH = "d3333333-3333-4333-8333-333333333333";

// 人気銘柄（popularity_rank あり）。フォールバック母集団。
const SAKE_POP_1 = "e1111111-1111-4111-8111-111111111111";
const SAKE_POP_2 = "e2222222-2222-4222-8222-222222222222";
const SAKE_POP_3 = "e3333333-3333-4333-8333-333333333333";

const TAG_KARA = "f1111111-1111-4111-8111-111111111111"; // 辛口
const TAG_TANREI = "f2222222-2222-4222-8222-222222222222"; // 淡麗
const TAG_HANAYAKA = "f3333333-3333-4333-8333-333333333333"; // 華やか

const NOW = new Date("2026-07-04T00:00:00Z").getTime();
const RECENT = new Date("2026-07-03T00:00:00Z");

// テストは Math.random に依存しないよう popularPoolSize=limit で母集団=返却数にする。
const CONFIG: RuleBasedConfig = {
  coldStartThreshold: 3,
  recentHistoryLimit: 100,
  popularPoolSize: 3,
};

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

  await db.exec(
    `INSERT INTO auth.users (id) VALUES ('${USER_ACTIVE}'), ('${USER_SPARSE}');`,
  );

  await orm.insert(schema.breweries).values([
    { id: BREWERY_YAMAGUCHI, name: "旭酒造", prefectureCode: "35" },
    { id: BREWERY_NIIGATA, name: "朝日酒造", prefectureCode: "15" },
  ]);

  await orm.insert(schema.sakes).values([
    { id: SAKE_VIEWED, breweryId: BREWERY_YAMAGUCHI, name: "獺祭 閲覧済" },
    { id: SAKE_MATCH_STRONG, breweryId: BREWERY_YAMAGUCHI, name: "獺祭 磨き" },
    { id: SAKE_MATCH_WEAK, breweryId: BREWERY_YAMAGUCHI, name: "東洋美人" },
    { id: SAKE_NOMATCH, breweryId: BREWERY_NIIGATA, name: "久保田" },
    // 人気銘柄（popularity_rank あり・タグは付けない＝嗜好一致しない）。
    {
      id: SAKE_POP_1,
      breweryId: BREWERY_NIIGATA,
      name: "人気酒1",
      popularityRank: 1,
    },
    {
      id: SAKE_POP_2,
      breweryId: BREWERY_NIIGATA,
      name: "人気酒2",
      popularityRank: 2,
    },
    {
      id: SAKE_POP_3,
      breweryId: BREWERY_NIIGATA,
      name: "人気酒3",
      popularityRank: 3,
    },
  ]);

  await orm.insert(schema.tags).values([
    { id: TAG_KARA, name: "辛口", category: "taste" },
    { id: TAG_TANREI, name: "淡麗", category: "taste" },
    { id: TAG_HANAYAKA, name: "華やか", category: "taste" },
  ]);

  await orm.insert(schema.sakeTags).values([
    { sakeId: SAKE_VIEWED, tagId: TAG_KARA, source: "sakenowa" },
    { sakeId: SAKE_MATCH_STRONG, tagId: TAG_KARA, source: "sakenowa" },
    { sakeId: SAKE_MATCH_STRONG, tagId: TAG_TANREI, source: "sakenowa" },
    { sakeId: SAKE_MATCH_WEAK, tagId: TAG_KARA, source: "sakenowa" },
    { sakeId: SAKE_NOMATCH, tagId: TAG_HANAYAKA, source: "sakenowa" },
  ]);

  // USER_ACTIVE の履歴: 辛口・淡麗の山口銘柄を閲覧＋辛口検索（嗜好=辛口/淡麗/山口）。
  await orm.insert(schema.viewHistories).values([
    { userId: USER_ACTIVE, sakeId: SAKE_VIEWED, viewedAt: RECENT },
    { userId: USER_ACTIVE, sakeId: SAKE_VIEWED, viewedAt: RECENT },
  ]);
  await orm.insert(schema.searchHistories).values([
    {
      userId: USER_ACTIVE,
      query: null,
      filters: { prefectureCode: "35", tagNames: ["辛口", "淡麗"] },
      searchedAt: RECENT,
    },
  ]);

  // USER_SPARSE の履歴: 1 件のみ（しきい値 3 未満＝コールドスタート）。
  await orm
    .insert(schema.viewHistories)
    .values([{ userId: USER_SPARSE, sakeId: SAKE_VIEWED, viewedAt: RECENT }]);
});

describe("recommendRuleBased（履歴ベース）", () => {
  it("嗜好に合う未閲覧銘柄を上位に返し、閲覧済みは除外する", async () => {
    const result = await recommendRuleBased(
      orm,
      { userId: USER_ACTIVE, limit: 5 },
      CONFIG,
      NOW,
    );
    const ids = result.map((r) => r.sake.id);
    // 閲覧済み銘柄は出ない。
    expect(ids).not.toContain(SAKE_VIEWED);
    // 辛口＋淡麗＋山口の SAKE_MATCH_STRONG が辛口のみの SAKE_MATCH_WEAK より上位。
    expect(ids.indexOf(SAKE_MATCH_STRONG)).toBeLessThan(
      ids.indexOf(SAKE_MATCH_WEAK),
    );
    // 上位は履歴ベースの理由（根拠シグナル付き）。
    const strong = result.find((r) => r.sake.id === SAKE_MATCH_STRONG);
    expect(strong?.reason.kind).toBe("history");
    if (strong?.reason.kind === "history") {
      expect(strong.reason.signals).toContainEqual({
        type: "tag",
        label: "辛口",
      });
    }
  });

  it("嗜好一致が limit に満たなければ人気銘柄で補完する", async () => {
    const result = await recommendRuleBased(
      orm,
      { userId: USER_ACTIVE, limit: 5 },
      CONFIG,
      NOW,
    );
    // 一致は 2 件（strong/weak）。残りは人気銘柄（popular reason）で埋まる。
    expect(result.length).toBeGreaterThan(2);
    const popularEntries = result.filter((r) => r.reason.kind === "popular");
    expect(popularEntries.length).toBeGreaterThan(0);
  });

  it("limit を超えて返さない", async () => {
    const result = await recommendRuleBased(
      orm,
      { userId: USER_ACTIVE, limit: 1 },
      CONFIG,
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].sake.id).toBe(SAKE_MATCH_STRONG);
  });
});

describe("recommendRuleBased（コールドスタート）", () => {
  it("未ログイン（userId=null）は人気ランキングを返す", async () => {
    const result = await recommendRuleBased(
      orm,
      { userId: null, limit: 3 },
      CONFIG,
      NOW,
    );
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.reason.kind === "popular")).toBe(true);
    const ids = result.map((r) => r.sake.id).sort();
    expect(ids).toEqual([SAKE_POP_1, SAKE_POP_2, SAKE_POP_3].sort());
  });

  it("履歴がしきい値未満のユーザーも人気ランキングにフォールバックする", async () => {
    const result = await recommendRuleBased(
      orm,
      { userId: USER_SPARSE, limit: 3 },
      CONFIG,
      NOW,
    );
    expect(result.every((r) => r.reason.kind === "popular")).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("limit 0 は空を返す", async () => {
    const result = await recommendRuleBased(
      orm,
      { userId: null, limit: 0 },
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
  });
});
