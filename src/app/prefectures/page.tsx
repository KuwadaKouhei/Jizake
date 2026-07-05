import type { Metadata } from "next";

import { JapanMap } from "./_components/japan-map";

/**
 * 都道府県選択ページ（/prefectures）— 地酒一覧の入口（FR-07）。
 *
 * タップ可能な日本地図（SVG）から /prefectures/[code] の県別一覧へ遷移させる
 * （T19: 文字リストから地図へ置き換え。FR-07 の「マップまたはリスト」のマップ実装）。
 * 定数（都道府県マスタ＋同梱パスデータ）だけで構成され DB 依存がないため静的に配信できる。
 */

export const metadata: Metadata = {
  title: "都道府県から地酒を探す",
  description:
    "日本地図から都道府県を選んで、その土地の日本酒（地酒）の一覧を表示します。",
};

export default function PrefecturesIndexPage() {
  return (
    <section className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <header className="mb-6 border-b pb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          都道府県から地酒を探す
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          地図から都道府県を選ぶと、その土地の蔵元がつくる日本酒の一覧を表示します。
        </p>
      </header>

      <JapanMap />
    </section>
  );
}
