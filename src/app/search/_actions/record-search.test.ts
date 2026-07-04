import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/lib/auth/server";
import * as schema from "@/lib/db/schema";
import type { SearchCriteria } from "@/lib/search-query";

/**
 * 検索履歴記録 Server Action（recordSearch）のテスト。
 *
 * 検証項目（TASKS ⑤）: 未ログイン no-op・空条件スキップ・正常記録・filters スナップショット・
 * 0 件検索でも条件があれば記録・user_id 強制。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const { getCurrentUser } = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
}));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => orm }));

import { recordSearch } from "./record-search";

function criteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return { tagNames: [], page: 1, ...overrides };
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
  await db.exec(`INSERT INTO auth.users (id) VALUES ('${USER_ID}');`);
});

beforeEach(async () => {
  getCurrentUser.mockReset();
  await orm.delete(schema.searchHistories);
});

async function rows() {
  return orm.select().from(schema.searchHistories);
}

describe("recordSearch", () => {
  it("空条件（名前・都道府県・タグなし）は記録しない", async () => {
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: null });
    await recordSearch(criteria());
    expect(await rows()).toHaveLength(0);
    // 空条件は user 取得すら不要（isEmptyCriteria が先に弾く）。
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("未ログインなら記録しない（no-op）", async () => {
    getCurrentUser.mockResolvedValue(null);
    await recordSearch(criteria({ q: "獺祭" }));
    expect(await rows()).toHaveLength(0);
  });

  it("名前条件は query カラムに、都道府県・タグは filters(jsonb) に入れる", async () => {
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: null });
    await recordSearch(
      criteria({ q: "獺祭", prefectureCode: "35", tagNames: ["辛口"] }),
    );
    const list = await rows();
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe(USER_ID);
    expect(list[0].query).toBe("獺祭");
    expect(list[0].filters).toEqual({
      prefectureCode: "35",
      tagNames: ["辛口"],
    });
  });

  it("名前のみの検索は filters を空にし query だけ入れる", async () => {
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: null });
    await recordSearch(criteria({ q: "久保田" }));
    const list = await rows();
    expect(list[0].query).toBe("久保田");
    expect(list[0].filters).toEqual({});
  });

  it("都道府県のみ・名前なしは query を NULL にする", async () => {
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: null });
    await recordSearch(criteria({ prefectureCode: "13" }));
    const list = await rows();
    expect(list[0].query).toBeNull();
    expect(list[0].filters).toEqual({ prefectureCode: "13" });
  });

  it("page は filters に含めない（ページ送りは同一検索）", async () => {
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: null });
    await recordSearch(criteria({ tagNames: ["淡麗"], page: 3 }));
    const list = await rows();
    expect(list[0].filters).toEqual({ tagNames: ["淡麗"] });
  });
});
