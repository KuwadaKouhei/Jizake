import { asc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  type CatalogDb,
  isValidSakeId,
  type SakeSummary,
  selectTagsBySakeIds,
} from "@/lib/db/queries/sakes";
import { breweries, sakes } from "@/lib/db/schema";

/**
 * 捏造防止の DB 存在検証（DESIGN §2.6 捏造防止の二段目 / §5.3）。
 *
 * LLM が structured output（proposeSake ツール）で返した銘柄 ID 配列を受け取り、
 * **DB に実在する sake だけ**に絞って SakeSummary（カード表示・/sake/[id] 詳細リンクに
 * 必要な情報）を返す。存在しない ID・書式不正な ID は黙って捨てる。
 *
 * これが T14 チャットの「DB に無い銘柄を提案しない」を担保する要である。
 * LLM の自由文をカードにせず、ここを通過した実在銘柄だけをストリームに載せることで、
 * ハルシネーション表示を構造的に不可能にする（DESIGN §6.2 プロンプトインジェクション対策）。
 *
 * LLM 非依存（DIRECTORY_STRUCTURE §3: src/lib/rag は LLM を呼ばない）で、
 * PGlite で単体統合テストできる。
 */

type Db = CatalogDb;

/**
 * 検証する提案 ID の最大件数。LLM の structured output は信頼境界の外なので、
 * 巨大な ID 配列（巨大 IN の DoS）を防ぐため先頭 MAX_PROPOSED_IDS 件だけを検証する
 * （提案として提示するのは高々数枚のカード。REVIEW T12 SEC S-1）。
 */
const MAX_PROPOSED_IDS = 16;

/**
 * 提案 ID 配列を DB 存在検証し、実在銘柄の SakeSummary を返す（db を明示的に受ける下位関数）。
 * テストでは PGlite を差し込むためにこちらを直接呼ぶ。
 *
 * - 先頭 MAX_PROPOSED_IDS 件だけを検証対象にする（巨大 IN の DoS 防御。SEC S-1）。
 * - UUID v4 書式でない ID は DB へ問い合わせる前に弾く（不正入力の境界検証。isValidSakeId 再利用）。
 * - 重複 ID は 1 件に畳む（LLM が同じ銘柄を複数回返しても提案は 1 枚）。
 * - **返す順序は入力 ids の順序を保つ**（LLM の提案順＝提示したい優先順を尊重）。
 *   存在しない ID はスキップして詰める。
 * - タグは selectTagsBySakeIds で一括取得（N+1 回避）。
 */
export async function selectExistingSakes(
  db: Db,
  ids: readonly string[],
): Promise<SakeSummary[]> {
  // 書式検証＋重複除去（入力順を保ったユニーク化）。信頼境界外の入力を先頭上限で切ってから処理する。
  const seen = new Set<string>();
  const validIds: string[] = [];
  for (const id of ids.slice(0, MAX_PROPOSED_IDS)) {
    if (isValidSakeId(id) && !seen.has(id)) {
      seen.add(id);
      validIds.push(id);
    }
  }
  if (validIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      id: sakes.id,
      name: sakes.name,
      breweryName: breweries.name,
      prefectureCode: breweries.prefectureCode,
    })
    .from(sakes)
    .innerJoin(breweries, eq(breweries.id, sakes.breweryId))
    .where(inArray(sakes.id, validIds))
    // DB の返却順は不定なので、入力順は下で復元する。ここは決定性のための安定順。
    .orderBy(asc(sakes.id));

  const tagsBySakeId = await selectTagsBySakeIds(
    db,
    rows.map((row) => row.id),
  );

  const byId = new Map<string, SakeSummary>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        breweryName: row.breweryName,
        prefectureCode: row.prefectureCode,
        tags: tagsBySakeId.get(row.id) ?? [],
      },
    ]),
  );

  // 入力 ids の順序で、実在するものだけを詰めて返す。
  const result: SakeSummary[] = [];
  for (const id of validIds) {
    const summary = byId.get(id);
    if (summary !== undefined) {
      result.push(summary);
    }
  }
  return result;
}

/**
 * 提案 ID 配列を DB 存在検証する公開関数（DESIGN §5.3: validateProposedSakeIds）。
 *
 * T14 の /api/chat が proposeSake の structured output（ID 配列）を受けて呼び、
 * 通過した実在銘柄のみをカードデータとしてストリームに載せる。
 */
export function validateProposedSakeIds(
  ids: readonly string[],
): Promise<SakeSummary[]> {
  return selectExistingSakes(getDb(), ids);
}
