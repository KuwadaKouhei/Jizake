import { getDb } from "@/lib/db/client";

import { recommendRuleBased } from "./rule-based";
import type { RecommendInput, RecommendedSake } from "./types";

export type {
  RecommendInput,
  RecommendReason,
  RecommendSignal,
  RecommendedSake,
} from "./types";

/**
 * 推薦の公開エントリポイント（固定 IF・DESIGN §2.5 / §5.3）。
 *
 * **実装の選択はこのファイルだけが行う**（DIRECTORY_STRUCTURE 例2・DIR-6）。現在は
 * ルールベース（タグ頻度＋時間減衰）を採用。将来 協調フィルタリング等へ差し替える際は
 * ここの委譲先を別実装に変えるだけで、呼び出し側（ホーム画面 src/app/page.tsx）は
 * 無変更で済む（差し替え可能な知能。PLAN_PHILOSOPHY 原則3）。
 *
 * オンデマンド計算（事前バッチ・キャッシュを持たない。DESIGN §2.5・決定 D6）。
 */
export function recommend(input: RecommendInput): Promise<RecommendedSake[]> {
  return recommendRuleBased(getDb(), input);
}
