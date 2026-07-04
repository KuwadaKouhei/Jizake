import type { SakeSummary } from "@/lib/db/queries/sakes";

/**
 * 推薦エンジンの固定インターフェース（PLAN_PHILOSOPHY 原則3「差し替え可能な知能」／
 * DESIGN §2.5）。
 *
 * **入出力のみを固定し、実装は差し替え可能にする**。呼び出し側（ホーム画面）は
 * この型と `recommend()`（src/lib/recommend/index.ts）だけに依存し、内部の
 * スコアリング実装（今回はタグ頻度＋時間減衰のルールベース）を将来 協調フィルタリング
 * 等へ差し替えても無変更で済むようにする（DIRECTORY_STRUCTURE 例2）。
 *
 * ここは「入力=ユーザー履歴（を引く userId）、出力=日本酒リスト」という契約の定義に
 * 徹し、DB アクセス・スコアリングの具体は持たない（依存方向: 上位はこの型のみ知る）。
 */

/** 推薦の入力。userId が null（未ログイン）なら履歴を引けずフォールバックに落ちる。 */
export type RecommendInput = {
  /** 対象ユーザー。未ログインは null（コールドスタート＝人気ランキング）。 */
  userId: string | null;
  /** 返す件数の上限。 */
  limit: number;
};

/**
 * 推薦理由（透明性のため UI に表示する。DESIGN §4.2「reason を表示して推薦の透明性を確保」）。
 *
 * 差し替え可能性のため理由は「種類 + 根拠シグナル」の構造で表現し、UI 側で文言化する
 * （実装が変わっても RecommendReason の形が同じなら UI は無変更）。
 * - popular: 履歴が無い/少ない/未ログインのフォールバック（人気ランキング由来）。
 * - history: 履歴ベース。どのタグ・都道府県が効いたかを signals に持つ。
 */
export type RecommendReason =
  { kind: "popular" } | { kind: "history"; signals: RecommendSignal[] };

/** 履歴ベース推薦で「効いた」根拠（表示用ラベルと種別）。 */
export type RecommendSignal =
  { type: "tag"; label: string } | { type: "prefecture"; code: string };

/** 推薦結果 1 件（銘柄要約＋推薦理由）。sake は SakeCard がそのまま受け取れる。 */
export type RecommendedSake = {
  sake: SakeSummary;
  reason: RecommendReason;
};
