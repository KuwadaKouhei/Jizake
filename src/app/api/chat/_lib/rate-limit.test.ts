import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import {
  countTodaySessions,
  isRateLimited,
  MAX_SESSIONS_PER_DAY,
  startOfToday,
} from "./rate-limit";

/**
 * ログインユーザーのレート制限（TASKS T15 ②・DESIGN §6.3）のテスト。
 *
 * - isRateLimited / startOfToday は純関数。
 * - countTodaySessions は PGlite（drizzle マイグレーション一式）で当日作成数のカウントを検証する。
 *   本人分のみ・当日分のみを数えること（他人・昨日分が混ざらないこと）を固定する。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    `INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');`,
  );
});

beforeEach(async () => {
  await orm.delete(schema.chatSessions);
});

describe("isRateLimited（純関数）", () => {
  it("上限未満は false", () => {
    expect(isRateLimited(0)).toBe(false);
    expect(isRateLimited(MAX_SESSIONS_PER_DAY - 1)).toBe(false);
  });

  it("上限ちょうど・上限超過は true（21 回目の開始を止める）", () => {
    expect(isRateLimited(MAX_SESSIONS_PER_DAY)).toBe(true);
    expect(isRateLimited(MAX_SESSIONS_PER_DAY + 5)).toBe(true);
  });

  it("limit 引数で上限を差し替えられる", () => {
    expect(isRateLimited(3, 3)).toBe(true);
    expect(isRateLimited(2, 3)).toBe(false);
  });
});

describe("startOfToday（純関数）", () => {
  it("時刻を 0 時に落とす", () => {
    const start = startOfToday(new Date("2026-07-04T15:30:45.123Z"));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });
});

describe("countTodaySessions（PGlite）", () => {
  it("当日作成した本人の会話数を数える", async () => {
    const now = new Date();
    await orm.insert(schema.chatSessions).values([
      { userId: USER_A, createdAt: now },
      { userId: USER_A, createdAt: now },
    ]);
    expect(await countTodaySessions(orm, USER_A, now)).toBe(2);
  });

  it("他人の会話は数えない（本人分のみ）", async () => {
    const now = new Date();
    await orm.insert(schema.chatSessions).values([
      { userId: USER_A, createdAt: now },
      { userId: USER_B, createdAt: now },
      { userId: USER_B, createdAt: now },
    ]);
    expect(await countTodaySessions(orm, USER_A, now)).toBe(1);
  });

  it("前日以前の会話は数えない（当日分のみ）", async () => {
    const now = new Date("2026-07-04T10:00:00");
    const yesterday = new Date("2026-07-03T23:00:00");
    await orm.insert(schema.chatSessions).values([
      { userId: USER_A, createdAt: yesterday },
      { userId: USER_A, createdAt: now },
    ]);
    expect(await countTodaySessions(orm, USER_A, now)).toBe(1);
  });

  it("会話が無ければ 0", async () => {
    expect(await countTodaySessions(orm, USER_A, new Date())).toBe(0);
  });
});
