"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import { cn } from "@/components/ui/cn";

import { readFavoriteState, toggleFavorite } from "../_actions/toggle-favorite";

/**
 * お気に入りボタン（詳細ページ）— T25 / FR-10。
 *
 * 詳細ページは静的寄り配信（revalidate=3600）なので、このボタンだけが自己完結の
 * 動的アイランドとして振る舞う: マウント時に readFavoriteState でログイン状態と
 * 登録状態を取得し、ボタン/ログイン誘導を出し分ける。
 *
 * - 未ログイン: ログイン誘導リンク（next で現在の詳細ページへ戻す）。
 * - ログイン済み: トグルボタン。楽観的更新し、Server Action の結果で確定する。
 *   セッション切れ（unauthenticated）ならログインへ誘導する。
 */
export function FavoriteButton({ sakeId }: { sakeId: string }) {
  const [state, setState] = useState<{
    loaded: boolean;
    isLoggedIn: boolean;
    favorited: boolean;
  }>({ loaded: false, isLoggedIn: false, favorited: false });
  const [pending, startTransition] = useTransition();

  const loginHref = `/login?next=${encodeURIComponent(`/sake/${sakeId}`)}`;

  useEffect(() => {
    let active = true;
    void readFavoriteState(sakeId).then((result) => {
      if (active) {
        setState({ loaded: true, ...result });
      }
    });
    return () => {
      active = false;
    };
  }, [sakeId]);

  // 取得前はレイアウトを保つプレースホルダ（ちらつき防止）。
  if (!state.loaded) {
    return (
      <div
        className="inline-flex h-9 w-44 animate-pulse rounded-full bg-muted"
        aria-hidden
      />
    );
  }

  if (!state.isLoggedIn) {
    return (
      <Link
        href={loginHref}
        className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-muted"
      >
        <Heart className="size-4" aria-hidden />
        ログインしてお気に入り
      </Link>
    );
  }

  const favorited = state.favorited;

  function onClick() {
    // 楽観的更新（先に見た目を反映し、失敗時に戻す）。
    const previous = favorited;
    setState((s) => ({ ...s, favorited: !previous }));
    startTransition(async () => {
      const result = await toggleFavorite(sakeId);
      if (result.ok) {
        setState((s) => ({ ...s, favorited: result.favorited }));
      } else {
        setState((s) => ({ ...s, favorited: previous }));
        if (result.reason === "unauthenticated") {
          window.location.href = loginHref;
        }
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={favorited}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border-[1.5px] px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60",
        favorited
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:border-primary/50 hover:bg-muted",
      )}
    >
      <Heart
        className={cn("size-4", favorited && "fill-current")}
        aria-hidden
      />
      {favorited ? "お気に入り済み" : "お気に入りに追加"}
    </button>
  );
}
