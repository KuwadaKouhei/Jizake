import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";
import { asc, eq, isNotNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { closeDb, getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { breweries, sakes } from "@/lib/db/schema";

import { searchSakeItems, type RakutenCredentials } from "./lib/rakuten/client";
import { selectBestItem, type RakutenItemCandidate } from "./lib/rakuten/match";

/**
 * 銘柄画像・楽天購入リンクの取得バッチ（FR-09・TASKS T17）。
 *
 * 楽天市場 商品検索 API で「銘柄名 蔵元名」を検索し、照合ロジック（match.ts）を
 * 通過した商品の画像 URL（楽天 CDN・_ex=400x400）を sakes.image_url に保存する。
 * 併せて rakuten_url が未設定の銘柄には商品ページ URL を補完する（既存値は上書きしない）。
 *
 * - 冪等・差分実行: image_url 済みの銘柄はスキップ（--force で再取得）。
 * - 既定の対象は説明文つき銘柄（seed 分＝アプリの主要導線に出る銘柄）。--all で全銘柄。
 * - レート制限: 1 リクエスト/秒（API の目安に従う）。
 * - 監査: 全対象の照合結果（採用/不採用と採用商品名）を tmp/rakuten-image-audit.csv に出す。
 *   誤マッチは「出さない」方向に倒す設計だが、最終確認は人の目で行えるようにする（FR-09）。
 */

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const REQUEST_INTERVAL_MS = 1_000;
const AUDIT_CSV_PATH = "tmp/rakuten-image-audit.csv";

type CliOptions = {
  /** true なら全銘柄（既定は説明文つき銘柄のみ）。 */
  all: boolean;
  /** true なら image_url 済みでも再取得して上書きする。 */
  force: boolean;
  /** 処理する最大件数（0 = 無制限）。動作確認用。 */
  limit: number;
};

export type AuditRow = {
  sakeId: string;
  sakeName: string;
  breweryName: string;
  result: "adopted" | "no_match" | "skipped_existing";
  itemName: string;
  imageUrl: string;
};

export type ImportImagesSummary = {
  targets: number;
  adopted: number;
  noMatch: number;
  skippedExisting: number;
  rakutenUrlFilled: number;
};

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { all: false, force: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--limit") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--limit には 1 以上の整数を指定してください");
      }
      options.limit = value;
      i++;
    } else {
      throw new Error(`不明な引数です: ${arg}（--all / --force / --limit N）`);
    }
  }
  return options;
}

/** CSV の 1 セルをエスケープする（" と改行・カンマを含む値をクォート）。 */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function writeAuditCsv(rows: readonly AuditRow[]): void {
  mkdirSync("tmp", { recursive: true });
  const header = "sake_id,sake_name,brewery_name,result,item_name,image_url";
  const lines = rows.map((row) =>
    [
      row.sakeId,
      row.sakeName,
      row.breweryName,
      row.result,
      row.itemName,
      row.imageUrl,
    ]
      .map(csvCell)
      .join(","),
  );
  writeFileSync(AUDIT_CSV_PATH, `${header}\n${lines.join("\n")}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 画像取得の本体（db・検索関数を注入可能にしてテストできる形にする）。
 * searchFn は 1 銘柄 1 回呼ばれる（レート制御は本関数が持つ）。
 */
export async function importRakutenImages(
  db: Db,
  options: CliOptions,
  searchFn: (keyword: string) => Promise<RakutenItemCandidate[]>,
  intervalMs = REQUEST_INTERVAL_MS,
): Promise<{ summary: ImportImagesSummary; audit: AuditRow[] }> {
  const targets = await db
    .select({
      id: sakes.id,
      name: sakes.name,
      breweryName: breweries.name,
      imageUrl: sakes.imageUrl,
      rakutenUrl: sakes.rakutenUrl,
    })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(options.all ? undefined : isNotNull(sakes.description))
    .orderBy(asc(sakes.name), asc(sakes.id));

  const limited = options.limit > 0 ? targets.slice(0, options.limit) : targets;

  const summary: ImportImagesSummary = {
    targets: limited.length,
    adopted: 0,
    noMatch: 0,
    skippedExisting: 0,
    rakutenUrlFilled: 0,
  };
  const audit: AuditRow[] = [];
  let requested = false;

  for (const target of limited) {
    if (!options.force && target.imageUrl !== null) {
      summary.skippedExisting++;
      audit.push({
        sakeId: target.id,
        sakeName: target.name,
        breweryName: target.breweryName,
        result: "skipped_existing",
        itemName: "",
        imageUrl: target.imageUrl,
      });
      continue;
    }

    // レート制限（1 リクエスト/秒）。初回は待たない。
    if (requested) {
      await sleep(intervalMs);
    }
    requested = true;

    const items = await searchFn(`${target.name} ${target.breweryName}`);
    const matched = selectBestItem(
      { name: target.name, breweryName: target.breweryName },
      items,
    );

    if (matched === null) {
      summary.noMatch++;
      audit.push({
        sakeId: target.id,
        sakeName: target.name,
        breweryName: target.breweryName,
        result: "no_match",
        itemName: "",
        imageUrl: "",
      });
      continue;
    }

    // rakuten_url は既存値を尊重して欠損時のみ補完する（手作業リンクを上書きしない）
    await db
      .update(sakes)
      .set({
        imageUrl: matched.imageUrl,
        rakutenUrl: sql`coalesce(${sakes.rakutenUrl}, ${matched.itemUrl})`,
        updatedAt: sql`now()`,
      })
      .where(eq(sakes.id, target.id));

    summary.adopted++;
    if (target.rakutenUrl === null) {
      summary.rakutenUrlFilled++;
    }
    audit.push({
      sakeId: target.id,
      sakeName: target.name,
      breweryName: target.breweryName,
      result: "adopted",
      itemName: matched.itemName,
      imageUrl: matched.imageUrl,
    });
  }

  return { summary, audit };
}

function logSummary(summary: ImportImagesSummary): void {
  console.log(`銘柄画像の取得が完了しました（対象 ${summary.targets} 件）`);
  console.log(
    `  採用 ${summary.adopted} 件 / 照合不成立 ${summary.noMatch} 件 / 取得済みスキップ ${summary.skippedExisting} 件`,
  );
  console.log(`  楽天購入リンクの補完: ${summary.rakutenUrlFilled} 件`);
  console.log(`  監査ログ: ${AUDIT_CSV_PATH}（照合結果の目視確認用）`);
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const applicationId = process.env.RAKUTEN_APP_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;
  if (!applicationId || !accessKey) {
    throw new Error(
      "RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が未設定です。.env.local に設定してください（docs/SETUP.md §4.5）",
    );
  }
  const credentials: RakutenCredentials = { applicationId, accessKey };

  const options = parseArgs(process.argv.slice(2));
  const db = getDb();

  console.log(
    `楽天市場 API から銘柄画像を取得しています…（対象: ${options.all ? "全銘柄" : "説明文つき銘柄"}${options.force ? "・--force 再取得" : ""}）`,
  );
  const { summary, audit } = await importRakutenImages(db, options, (keyword) =>
    searchSakeItems(credentials, keyword),
  );
  writeAuditCsv(audit);
  logSummary(summary);
}

// テストから importRakutenImages を import しても実行されないようにする
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  void (async () => {
    try {
      await main();
    } catch (error) {
      console.error("銘柄画像の取得に失敗しました:", error);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  })();
}
