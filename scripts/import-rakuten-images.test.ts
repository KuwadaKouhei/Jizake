import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/lib/db/schema";

import { importRakutenImages } from "./import-rakuten-images";
import type { RakutenItemCandidate } from "./lib/rakuten/match";

/**
 * 画像取得バッチの統合テスト（PGlite）。FR-09 の受け入れ条件のうち
 * 「冪等・差分実行」「誤マッチ抑止で採用/不採用が分かれる」を実データ経路で確認し、
 * かつ **1 銘柄の API エラーで全体が止まらない**（堅牢性）ことを固定する。
 */

const db = new PGlite({ extensions: { vector } });
const orm = drizzle(db, { schema });

const CDN =
  "https://thumbnail.image.rakuten.co.jp/@0_mall/s/bottle.jpg?_ex=128x128";

function bottleItem(itemName: string): RakutenItemCandidate {
  return {
    itemName,
    itemUrl: "https://item.rakuten.co.jp/s/x/",
    mediumImageUrls: [CDN],
  };
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

  // 蔵元 1・銘柄 3（照合成功 / 照合失敗 / API エラー用）を投入する。
  const [brewery] = await orm
    .insert(schema.breweries)
    .values({ name: "テスト酒造", prefectureCode: "13" })
    .returning({ id: schema.breweries.id });

  await orm.insert(schema.sakes).values([
    { breweryId: brewery.id, name: "獺祭", description: "説明" },
    { breweryId: brewery.id, name: "八海山", description: "説明" },
    { breweryId: brewery.id, name: "壊れる酒", description: "説明" },
  ]);
});

afterAll(async () => {
  await db.close();
});

/** 「壊れる酒」だけ API エラー、「獺祭」は銘柄名一致、「八海山」は不一致にするフェイク検索。 */
async function fakeSearch(keyword: string): Promise<RakutenItemCandidate[]> {
  if (keyword.startsWith("壊れる酒")) {
    throw new Error("楽天商品検索 API がエラーを返しました（HTTP 400）");
  }
  if (keyword.startsWith("獺祭")) {
    return [bottleItem("獺祭 純米大吟醸 720ml")];
  }
  // 八海山: 銘柄名を含まない商品しか返らない → 照合不成立
  return [bottleItem("別の酒 720ml")];
}

async function imageUrlOf(name: string): Promise<string | null> {
  const rows = await orm
    .select({ name: schema.sakes.name, imageUrl: schema.sakes.imageUrl })
    .from(schema.sakes);
  return rows.find((r) => r.name === name)?.imageUrl ?? null;
}

describe("importRakutenImages（PGlite・堅牢性）", () => {
  it("1 銘柄の API エラーで止まらず、他銘柄は採用/不成立で処理が続く", async () => {
    const { summary, audit } = await importRakutenImages(
      orm,
      { all: false, force: false, limit: 0 },
      fakeSearch,
      0, // テストではレート待機なし
    );

    // 3 銘柄すべて処理され、内訳が分かれる（エラーで中断しない）。
    expect(summary.targets).toBe(3);
    expect(summary.adopted).toBe(1); // 獺祭
    expect(summary.noMatch).toBe(1); // 八海山
    expect(summary.errors).toBe(1); // 壊れる酒
    expect(summary.rakutenUrlFilled).toBe(1);

    // 採用銘柄に楽天 CDN の画像（400x400 正規化）が入る。
    expect(await imageUrlOf("獺祭")).toBe(
      "https://thumbnail.image.rakuten.co.jp/@0_mall/s/bottle.jpg?_ex=400x400",
    );
    // 不成立・エラー銘柄は画像なしのまま。
    expect(await imageUrlOf("八海山")).toBeNull();
    expect(await imageUrlOf("壊れる酒")).toBeNull();

    // 監査にエラー行が残る（目視確認用）。
    expect(audit.find((r) => r.sakeName === "壊れる酒")?.result).toBe("error");
  });

  it("再実行は取得済みをスキップする（冪等・差分実行）", async () => {
    const { summary } = await importRakutenImages(
      orm,
      { all: false, force: false, limit: 0 },
      fakeSearch,
      0,
    );

    // 獺祭は取得済みでスキップ。八海山・壊れる酒は前回同様に不成立・エラー。
    expect(summary.skippedExisting).toBe(1);
    expect(summary.adopted).toBe(0);
    expect(summary.noMatch).toBe(1);
    expect(summary.errors).toBe(1);
  });
});
