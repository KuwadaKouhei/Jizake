"use client";

import { useEffect, useRef } from "react";

import { recordView } from "../_actions/record-view";

/**
 * 閲覧履歴の記録トリガ（Client Component）— DESIGN §2.4 / 決定 D3。
 *
 * 詳細ページ（RSC）に配置し、実ブラウザでのマウント時に Server Action recordView を
 * fire-and-forget で呼ぶ。RSC レンダリング中に記録しないことでプリフェッチ・キャッシュ・
 * ボットによる多重記録を避け、ユーザーの実閲覧のみを記録する。
 *
 * - fire-and-forget: recordView を await せず、Promise の失敗も UI に伝えない（Server Action
 *   側でログ済み）。表示（RSC）と記録（Action）のパスを分離し、記録失敗が表示を壊さない。
 * - 多重記録抑制: 同一マウント内の重複発火（React 18 StrictMode の二重マウント・sakeId 不変での
 *   再レンダリング）を useRef ガードで 1 回に抑える。sakeId が変わったら再度発火する
 *   （ページ内で別銘柄に切り替わる将来のケースに備え、値をキーにする）。
 * - 未ログイン時の no-op はサーバ側（recordView）で判定する。クライアントに認証状態を渡さない。
 *
 * 画面には何も描画しない（記録の副作用だけを担うマーカー）。
 */
export function RecordViewTrigger({ sakeId }: { sakeId: string }) {
  const recordedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (recordedForRef.current === sakeId) {
      return;
    }
    recordedForRef.current = sakeId;
    // await しない（fire-and-forget）。失敗は Server Action 内でログ済みだが、
    // Promise reject が未処理にならないよう catch でも握る（no-op）。
    void recordView(sakeId).catch(() => {});
  }, [sakeId]);

  return null;
}
