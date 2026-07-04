import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

// ホームのプレースホルダ。T10（履歴ベース推薦）で推薦カード列に置き換える。
// 実装済みの都道府県別一覧（T06）への導線を出す。
export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Jizake</h1>
      <p className="max-w-md text-muted-foreground">
        あなたにぴったりの日本酒が見つかる、日本酒レコメンドサービス。
        <br />
        まずは都道府県から、その土地の地酒を探してみましょう。
      </p>
      <Link href="/prefectures" className={buttonVariants()}>
        都道府県から地酒を探す
      </Link>
    </div>
  );
}
