import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { selectExistingSakes } from "@/lib/rag/validate-proposed";
import * as schema from "@/lib/db/schema";

import { SEED_SAKES } from "../../../seed-data/sakes";
import { seedSakes } from "../../seed";

/**
 * 捏造防止のエンドツーエンド確認（TASKS T13③）。
 *
 * 実 LLM を叩かず、proposeSake の structured output を模した「ダミー LLM 応答」
 * （実在銘柄 ID ＋ 実在しない ID を混ぜた提案）を作り、それを
 *   1. proposeSake 相当の Zod スキーマ（structured output の境界検証）でパースし、
 *   2. validateProposedSakeIds（= selectExistingSakes）で DB 存在検証する
 * ことで、**捏造された（DB に無い）ID がカード化される前に落ちる**ことを確認する。
 *
 * これは DESIGN §2.6 の捏造防止二段構えのうち二段目（サーバ側 DB 存在検証）の end-to-end 検証。
 * 実 LLM での試行（ヒアリング→条件変換→提案の往復）は実キー投入後の作業
 * （docs/RAG_POC.md の残作業）。ここではロジックの正しさを決定的に固める。
 */

// proposeSake の structured output を模した Zod スキーマ（T14 のツール定義の雛形。
// PoC で「スキーマ適合でも実在しない ID は落ちる」二段構えを検証するために置く）。
const proposeSakeSchema = z.object({
  proposals: z
    .array(
      z.object({
        sakeId: z.string(),
        reason: z.string().min(1),
      }),
    )
    .min(1),
});

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

let realIds: string[] = [];

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
  await seedSakes(orm, SEED_SAKES);
  const rows = await orm.select({ id: schema.sakes.id }).from(schema.sakes);
  realIds = rows.map((r) => r.id);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("捏造防止 E2E（ダミー LLM 提案 → 検証で存在しない ID を除去）", () => {
  it("実在 ID ＋ 存在しない ID を混ぜた提案から、実在銘柄だけが残る", async () => {
    const realA = realIds[0];
    const realB = realIds[1];
    // structured output に適合するが DB に存在しない UUID（捏造銘柄を模す）
    const fabricated = "00000000-0000-4000-8000-000000000000";

    // ダミー LLM 応答（proposeSake の structured output）
    const rawResponse = {
      proposals: [
        { sakeId: realA, reason: "華やかで飲みやすい" },
        { sakeId: fabricated, reason: "幻の銘柄（捏造）" },
        { sakeId: realB, reason: "食中酒に合う" },
      ],
    };

    // 1. structured output の境界検証（スキーマ適合）
    const parsed = proposeSakeSchema.parse(rawResponse);
    const proposedIds = parsed.proposals.map((p) => p.sakeId);
    expect(proposedIds).toContain(fabricated); // スキーマだけでは捏造 ID を通す

    // 2. DB 存在検証（二段目）で捏造 ID が落ちる
    const validated = await selectExistingSakes(orm, proposedIds);
    const validatedIds = validated.map((s) => s.id);

    expect(validatedIds).not.toContain(fabricated);
    // 実在銘柄は入力順（LLM の提示順）を保って残る
    expect(validatedIds).toEqual([realA, realB]);
    // カード化に必要な情報（名前・蔵元）が揃う
    expect(validated[0].name.length).toBeGreaterThan(0);
    expect(validated[0].breweryName.length).toBeGreaterThan(0);
  });

  it("全提案が捏造（実在しない ID）なら 1 件も残らない（提案ゼロにフォールバック可能）", async () => {
    const rawResponse = {
      proposals: [
        {
          sakeId: "11111111-1111-4111-8111-111111111111",
          reason: "捏造1",
        },
        {
          sakeId: "22222222-2222-4222-8222-222222222222",
          reason: "捏造2",
        },
      ],
    };
    const parsed = proposeSakeSchema.parse(rawResponse);
    const validated = await selectExistingSakes(
      orm,
      parsed.proposals.map((p) => p.sakeId),
    );
    expect(validated).toEqual([]);
  });

  it("UUID 書式ですらない捏造（銘柄名を ID 欄に入れる等）は DB 到達前に弾かれる", async () => {
    const rawResponse = {
      proposals: [
        { sakeId: "獺祭 純米大吟醸", reason: "名前を ID 欄に入れた捏造" },
        { sakeId: realIds[0], reason: "実在" },
      ],
    };
    const parsed = proposeSakeSchema.parse(rawResponse);
    const validated = await selectExistingSakes(
      orm,
      parsed.proposals.map((p) => p.sakeId),
    );
    // 書式不正はスキップされ、実在 ID のみ残る
    expect(validated.map((s) => s.id)).toEqual([realIds[0]]);
  });
});
