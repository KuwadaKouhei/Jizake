import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { signIn } from "@/lib/auth/actions";
import { resolveAfterLogin, sanitizeRedirectPath } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "ログイン",
  description: "Jizake にログインして閲覧・検索の履歴を利用する。",
};

// 認証状態に依存するため動的レンダリング（キャッシュしない）。
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const { next: rawNext } = await searchParams;
  const next = sanitizeRedirectPath(
    Array.isArray(rawNext) ? rawNext[0] : rawNext,
  );

  // 既にログイン済みなら遷移先（既定 /）へ送る。
  const user = await getCurrentUser();
  if (user) {
    redirect(resolveAfterLogin(next));
  }

  return (
    <section className="mx-auto w-full max-w-sm flex-1 px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">ログイン</h1>
      <AuthForm
        action={signIn}
        submitLabel="ログイン"
        next={next ?? undefined}
        altPrompt={{
          text: "アカウントをお持ちでない方は",
          linkLabel: "新規登録",
          href: next ? `/signup?next=${encodeURIComponent(next)}` : "/signup",
        }}
      />
    </section>
  );
}
