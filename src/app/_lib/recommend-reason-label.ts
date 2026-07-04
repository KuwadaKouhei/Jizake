import { findPrefectureByCode } from "@/lib/constants/prefectures";
import type { RecommendReason } from "@/lib/recommend";

/**
 * 推薦理由（RecommendReason）を UI 表示用の日本語ラベルに変換する純関数（ホーム専用）。
 *
 * 推薦の透明性のため各カードに「なぜおすすめか」を軽く添える（DESIGN §4.2）。
 * 文言生成を純関数に分離してユニットテスト対象にする（TEST_PHILOSOPHY）。
 * ここはホーム画面（/）でしか使わない機能固有ロジックのため `app/_lib` に置く
 * （DIRECTORY_STRUCTURE §3: セグメント専用ロジックは _lib）。
 *
 * 都道府県コード→県名は既存の constants マスタを再利用する（信頼できる内部定数）。
 */

// 根拠シグナルとして 1 カードに載せる上限（多すぎると理由がノイズになる）。
const MAX_SIGNALS = 2;

/** 推薦理由を「よく見ている『辛口』『山口県』から」のような 1 文にする。 */
export function recommendReasonLabel(reason: RecommendReason): string {
  if (reason.kind === "popular") {
    return "人気の銘柄";
  }

  const labels: string[] = [];
  for (const signal of reason.signals) {
    if (labels.length >= MAX_SIGNALS) {
      break;
    }
    if (signal.type === "tag") {
      labels.push(`「${signal.label}」`);
    } else {
      const prefecture = findPrefectureByCode(signal.code);
      if (prefecture) {
        labels.push(`「${prefecture.name}」`);
      }
    }
  }

  if (labels.length === 0) {
    // 履歴ベースだが表示できる根拠が無い（防御的）。汎用文言に倒す。
    return "あなたの履歴から";
  }
  return `よく見ている${labels.join("")}から`;
}
