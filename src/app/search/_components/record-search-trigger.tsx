"use client";

import { useEffect, useRef } from "react";

import { recordSearch } from "../_actions/record-search";
import type { SearchCriteria } from "../_lib/build-search-query";

/**
 * 検索履歴の記録トリガ（Client Component）— DESIGN §2.4 / 決定 D3。
 *
 * 検索結果ページ（RSC）に配置し、実ブラウザでのマウント時に Server Action recordSearch を
 * fire-and-forget で呼ぶ。RSC レンダリング中に記録しないことでプリフェッチ・ボットによる
 * 多重記録を避け、ユーザーの実検索のみを記録する。
 *
 * - 多重記録抑制: 同一検索条件での重複発火（StrictMode 二重マウント・ページャ以外の再レンダリング）
 *   を、条件のシリアライズ文字列をキーにした useRef ガードで 1 回に抑える。条件が変われば再記録する
 *   （別条件で検索し直したら新しい検索イベントとして残す）。page は条件に含めない（ページ送りは
 *   同一検索の続きであり、Server Action 側でも page を filters に入れない）。
 * - 空条件の除外・未ログイン no-op はサーバ側（recordSearch）で判定する。
 *
 * 画面には何も描画しない。
 */
export function RecordSearchTrigger({
  criteria,
}: {
  criteria: SearchCriteria;
}) {
  // page を除いた条件だけをキーにする（ページ送りでは再記録しない）。
  const key = JSON.stringify({
    q: criteria.q,
    prefectureCode: criteria.prefectureCode,
    tagNames: criteria.tagNames,
  });
  const recordedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (recordedForRef.current === key) {
      return;
    }
    recordedForRef.current = key;
    void recordSearch(criteria).catch(() => {});
    // criteria は key と 1:1 対応するため、依存は key のみで十分（criteria の参照変化で
    // 二重発火させない）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}
