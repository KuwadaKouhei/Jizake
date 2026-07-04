import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/lib/auth/server";
import * as schema from "@/lib/db/schema";

/**
 * 閲覧履歴記録 Server Action（recordView）のテスト。
 *
 * getCurrentUser（認証セッション）と getDb（DB クライアント）をモックし、
 * 実際の INSERT は PGlite で検証する。
 * 検証項目（TASKS ⑤）: 未ログイン no-op・不正 id no-op・正常記録・user_id 強制。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BREWERY_ID = "c1111111-1111-4111-8111-111111111111";
const SAKE_ID = "d1111111-1111-4111-8111-111111111111";

const { getCurrentUser } = vi.hoisted(() => ({
  getCurrentUser: vi.fn<() => Promise<AuthUser | null>>(),
}));
vi.mock("@/lib/auth/server", () => ({ getCurrentUser }));
vi.mock("@/lib/db/client", () => ({ getDb: () => orm }));

import { recordView } from "./record-view";

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
  await orm.insert(schema.breweries).values({
    id: BREWERY_ID,
    name: "旭酒造",
    prefectureCode: "35",
  });
  await orm
    .insert(schema.sakes)
    .values({ id: SAKE_ID, breweryId: BREWERY_ID, name: "獺祭" });
});

beforeEach(async () => {
  getCurrentUser.mockReset();
  await orm.delete(schema.viewHistories);
});

async function countHistory(): Promise<number> {
  const rows = await orm.select().from(schema.viewHistories);
  return rows.length;
}

describe("recordView", () => {
  it("未ログインなら記録しない（no-op）", async () => {
    getCurrentUser.mockResolvedValue(null);
    await recordView(SAKE_ID);
    expect(await countHistory()).toBe(0);
  });

  it("UUID 書式でない id は記録しない（境界検証）", async () => {
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: null });
    await recordView("not-a-uuid");
    expect(await countHistory()).toBe(0);
  });

  it("ログイン時はセッションの user_id で閲覧履歴を記録する", async () => {
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: "u@example.com" });
    await recordView(SAKE_ID);
    const rows = await orm
      .select()
      .from(schema.viewHistories)
      .where(eq(schema.viewHistories.sakeId, SAKE_ID));
    expect(rows).toHaveLength(1);
    // user_id は引数ではなくセッションから強制設定される（主防御）。
    expect(rows[0].userId).toBe(USER_ID);
  });

  it("同一銘柄を複数回呼ぶと追記される（追記専用イベントログ）", async () => {
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: null });
    await recordView(SAKE_ID);
    await recordView(SAKE_ID);
    expect(await countHistory()).toBe(2);
  });

  it("記録が失敗しても例外を投げない（fire-and-forget・ログのみ）", async () => {
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: null });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // 存在しない sake_id（FK 違反）でも表示を壊さず握って続行する。
    await expect(
      recordView("f0000000-0000-4000-8000-000000000000"),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
