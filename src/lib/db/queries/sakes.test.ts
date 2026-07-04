import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import {
  isValidSakeId,
  selectSakeDetail,
  selectSakesByPrefecture,
} from "./sakes";

/**
 * カタログ読み取りクエリ（詳細取得）のテスト。
 *
 * - isValidSakeId は純粋関数として境界検証を確認する。
 * - selectSakeDetail は PGlite（drizzle/ マイグレーション一式適用＋テスト内シード）で
 *   銘柄＋蔵元＋タグの結合・NULL 可カラム・存在しない id を検証する
 *   （TEST_PHILOSOPHY: テスト DB は PGlite・外部依存は使わない）。
 */

describe("isValidSakeId", () => {
  it("UUID 書式の文字列を受理する", () => {
    expect(isValidSakeId("11111111-1111-4111-8111-111111111111")).toBe(true);
  });

  it("UUID 書式でない文字列を弾く（不正 id は 404 に落とす）", () => {
    for (const invalid of [
      "not-a-uuid",
      "123",
      "",
      "11111111-1111-4111-8111", // 桁不足
      "'; DROP TABLE sakes; --", // SQL インジェクション様の入力
      "11111111-1111-1111-1111-111111111111", // v4 でない（version ニブルが 1）
      "11111111-1111-4111-c111-111111111111", // variant ニブルが不正（c）
    ]) {
      expect(isValidSakeId(invalid)).toBe(false);
    }
  });
});

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

// テストで参照する固定 ID（PK は UUID）
const BREWERY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FULL_SAKE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MINIMAL_SAKE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MISSING_SAKE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TYPE_TAG_ID = "e1111111-1111-4111-8111-111111111111";
const TASTE_TAG_ID = "e2222222-2222-4222-8222-222222222222";
// 別県（新潟 15）の蔵元・銘柄。県別一覧の絞り込み（他県を混ぜない）を検証する。
const NIIGATA_BREWERY_ID = "a1111111-1111-4111-8111-111111111111";
const NIIGATA_SAKE_ID = "b1111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  // Supabase 環境のスタブ（0002 のトリガ・RLS DDL が前提とする。既存テストと同型）
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

  await orm.insert(schema.breweries).values({
    id: BREWERY_ID,
    name: "旭酒造",
    prefectureCode: "35",
  });

  // 全項目を持つ銘柄（説明・URL・価格帯・フレーバー6軸）
  await orm.insert(schema.sakes).values({
    id: FULL_SAKE_ID,
    breweryId: BREWERY_ID,
    name: "獺祭 純米大吟醸 45",
    reading: "だっさい",
    description: "テスト用の自作説明文。\n改行を含む。",
    officialUrl: "https://example.com/dassai",
    amazonUrl: "https://www.amazon.co.jp/dp/TEST",
    priceRange: "over_3000",
    popularityRank: 1,
    flavorFloral: 0.8,
    flavorMellow: 0.4,
    flavorHeavy: 0.2,
    flavorMild: 0.5,
    flavorDry: 0.3,
    flavorLight: 0.7,
  });

  // 最小構成の銘柄（NULL 可カラムがすべて null・フレーバーなし）
  await orm.insert(schema.sakes).values({
    id: MINIMAL_SAKE_ID,
    breweryId: BREWERY_ID,
    name: "最小構成酒",
  });

  // 別県（新潟 15）の蔵元＋銘柄。県別一覧が prefecture_code で正しく絞ることの検証用。
  await orm.insert(schema.breweries).values({
    id: NIIGATA_BREWERY_ID,
    name: "八海醸造",
    prefectureCode: "15",
  });
  await orm.insert(schema.sakes).values({
    id: NIIGATA_SAKE_ID,
    breweryId: NIIGATA_BREWERY_ID,
    name: "八海山 純米吟醸",
  });

  await orm.insert(schema.tags).values([
    { id: TYPE_TAG_ID, name: "純米大吟醸", category: "type" },
    { id: TASTE_TAG_ID, name: "華やか", category: "taste" },
  ]);
  await orm.insert(schema.sakeTags).values([
    { sakeId: FULL_SAKE_ID, tagId: TYPE_TAG_ID, source: "manual" },
    { sakeId: FULL_SAKE_ID, tagId: TASTE_TAG_ID, source: "sakenowa" },
    // 新潟の銘柄にもタグを付け、一括取得（selectTagsBySakeIds）が
    // 銘柄ごとに正しく束ねることを検証できるようにする。
    { sakeId: NIIGATA_SAKE_ID, tagId: TYPE_TAG_ID, source: "sakenowa" },
  ]);
});

afterAll(async () => {
  await db.close();
});

describe("selectSakeDetail", () => {
  it("銘柄＋蔵元＋タグを結合して返す（FR-01・FR-02）", async () => {
    const detail = await selectSakeDetail(orm, FULL_SAKE_ID);

    expect(detail).not.toBeNull();
    expect(detail?.name).toBe("獺祭 純米大吟醸 45");
    expect(detail?.breweryName).toBe("旭酒造");
    expect(detail?.prefectureCode).toBe("35");
    expect(detail?.description).toBe("テスト用の自作説明文。\n改行を含む。");
    expect(detail?.officialUrl).toBe("https://example.com/dassai");
    expect(detail?.amazonUrl).toBe("https://www.amazon.co.jp/dp/TEST");
    expect(detail?.rakutenUrl).toBeNull();
    expect(detail?.priceRange).toBe("over_3000");
  });

  it("タグが category → name 順で source 付きで返る（FR-02）", async () => {
    const detail = await selectSakeDetail(orm, FULL_SAKE_ID);

    // category 昇順（taste が type より先）→ name 昇順
    expect(detail?.tags).toEqual([
      {
        id: TASTE_TAG_ID,
        name: "華やか",
        category: "taste",
        source: "sakenowa",
      },
      {
        id: TYPE_TAG_ID,
        name: "純米大吟醸",
        category: "type",
        source: "manual",
      },
    ]);
  });

  it("フレーバー6軸を FlavorChart として返す", async () => {
    const detail = await selectSakeDetail(orm, FULL_SAKE_ID);

    expect(detail?.flavor).toEqual({
      floral: 0.8,
      mellow: 0.4,
      heavy: 0.2,
      mild: 0.5,
      dry: 0.3,
      light: 0.7,
    });
  });

  it("NULL 可カラムが未設定の銘柄は null を返し、フレーバーも null になる（FR-03: 無い場合は非表示）", async () => {
    const detail = await selectSakeDetail(orm, MINIMAL_SAKE_ID);

    expect(detail).not.toBeNull();
    expect(detail?.description).toBeNull();
    expect(detail?.officialUrl).toBeNull();
    expect(detail?.amazonUrl).toBeNull();
    expect(detail?.rakutenUrl).toBeNull();
    expect(detail?.priceRange).toBeNull();
    expect(detail?.flavor).toBeNull();
    expect(detail?.tags).toEqual([]);
  });

  it("存在しない id は null を返す（notFound へ落とす）", async () => {
    expect(await selectSakeDetail(orm, MISSING_SAKE_ID)).toBeNull();
  });

  it("UUID 書式でない id は DB に問い合わせず null を返す", async () => {
    expect(await selectSakeDetail(orm, "not-a-uuid")).toBeNull();
  });
});

describe("selectSakesByPrefecture", () => {
  it("指定した都道府県の銘柄のみを蔵元 JOIN で返す（FR-07）", async () => {
    const list = await selectSakesByPrefecture(orm, "35"); // 山口

    const ids = list.map((sake) => sake.id);
    expect(ids).toContain(FULL_SAKE_ID);
    expect(ids).toContain(MINIMAL_SAKE_ID);
    // 他県（新潟）の銘柄は混ざらない
    expect(ids).not.toContain(NIIGATA_SAKE_ID);
    for (const sake of list) {
      expect(sake.prefectureCode).toBe("35");
      expect(sake.breweryName).toBe("旭酒造");
    }
  });

  it("各銘柄に主要タグを束ねて返す（N+1 を避けた一括取得）", async () => {
    const list = await selectSakesByPrefecture(orm, "35");
    const full = list.find((sake) => sake.id === FULL_SAKE_ID);
    const minimal = list.find((sake) => sake.id === MINIMAL_SAKE_ID);

    // FULL は 2 タグ（category → name 順）
    expect(full?.tags).toEqual([
      {
        id: TASTE_TAG_ID,
        name: "華やか",
        category: "taste",
        source: "sakenowa",
      },
      {
        id: TYPE_TAG_ID,
        name: "純米大吟醸",
        category: "type",
        source: "manual",
      },
    ]);
    // タグ無しの銘柄は空配列（他銘柄のタグが漏れ込まない）
    expect(minimal?.tags).toEqual([]);
  });

  it("別県の銘柄には、その県のタグだけが束ねられる", async () => {
    const list = await selectSakesByPrefecture(orm, "15"); // 新潟
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(NIIGATA_SAKE_ID);
    expect(list[0]?.tags).toEqual([
      {
        id: TYPE_TAG_ID,
        name: "純米大吟醸",
        category: "type",
        source: "sakenowa",
      },
    ]);
  });

  it("並び順は呼び出し間で決定的である（安定順）", async () => {
    const first = await selectSakesByPrefecture(orm, "35");
    const second = await selectSakesByPrefecture(orm, "35");
    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id));
  });

  it("銘柄が存在しない都道府県は空配列を返す（空状態メッセージへ）", async () => {
    const list = await selectSakesByPrefecture(orm, "47"); // 沖縄（未投入）
    expect(list).toEqual([]);
  });
});
