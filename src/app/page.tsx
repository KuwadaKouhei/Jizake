// ホームのプレースホルダ。T10（履歴ベース推薦）で推薦カード列に置き換える。
export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Jizake</h1>
      <p className="max-w-md text-muted-foreground">
        あなたにぴったりの日本酒が見つかる、日本酒レコメンドサービス。ただいま準備中です。
      </p>
    </div>
  );
}
