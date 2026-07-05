import type { Metadata } from "next";
import Link from "next/link";

import { groupPrefecturesByRegion } from "./_lib/regions";

/**
 * 都道府県選択ページ（/prefectures）— 地酒一覧の入口（FR-07）。
 *
 * 47 都道府県を地方でグルーピングしたリンク一覧を表示し、
 * /prefectures/[code] の県別一覧へ遷移させる。
 * 定数（都道府県マスタ）だけで構成され DB 依存がないため静的に配信できる。
 */

export const metadata: Metadata = {
  title: "都道府県から地酒を探す",
  description: "都道府県を選んで、その土地の日本酒（地酒）の一覧を表示します。",
};

export default function PrefecturesIndexPage() {
  const regions = groupPrefecturesByRegion();

  return (
    <section className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <header className="mb-8 border-b pb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          都道府県から地酒を探す
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          都道府県を選ぶと、その土地の蔵元がつくる日本酒の一覧を表示します。
        </p>
      </header>

      <div className="grid gap-8">
        {regions.map((region) => (
          <div key={region.name}>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
              {region.name}
            </h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {region.prefectures.map((prefecture) => (
                <li key={prefecture.code}>
                  <Link
                    href={`/prefectures/${prefecture.code}`}
                    className="block rounded-sm border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {prefecture.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
