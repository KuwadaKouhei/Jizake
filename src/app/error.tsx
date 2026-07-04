"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

// 想定外エラーのバウンダリ。ユーザーには回復手段（再試行）を示す（CODING_PHILOSOPHY 原則5）
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">エラーが発生しました</h1>
      <p className="text-muted-foreground">
        申し訳ありません。時間をおいて再度お試しください。
      </p>
      <Button onClick={reset}>再試行する</Button>
    </div>
  );
}
