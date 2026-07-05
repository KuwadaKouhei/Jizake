import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { signIn } from "@/lib/auth/actions";
import { oauthErrorMessage } from "@/lib/auth/messages";
import { resolveAfterLogin, sanitizeRedirectPath } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/server";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";

export const metadata: Metadata = {
  title: "ログイン",
  description: "Jizake にログインして閲覧・検索の履歴を利用する。",
};

// 認証状態に依存するため動的レンダリング（キャッシュしない）。
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const { next: rawNext, error: rawError } = await searchParams;
  const next = sanitizeRedirectPath(
    Array.isArray(rawNext) ? rawNext[0] : rawNext,
  );
  const errorParam = Array.isArray(rawError) ? rawError[0] : rawError;

  // 既にログイン済みなら遷移先（既定 /）へ送る。
  const user = await getCurrentUser();
  if (user) {
    redirect(resolveAfterLogin(next));
  }

  return (
    <section className="mx-auto w-full max-w-sm flex-1 px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">ログイン</h1>

      {errorParam === "oauth" ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {oauthErrorMessage()}
        </p>
      ) : null}

      <GoogleSignInButton next={next ?? undefined} />

      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        または
        <span className="h-px flex-1 bg-border" />
      </div>

      <AuthForm
        action={signIn}
        submitLabel="ログイン"
        next={next ?? undefined}
        passwordAutoComplete="current-password"
        passwordMinLength={PASSWORD_MIN_LENGTH}
        altPrompt={{
          text: "アカウントをお持ちでない方は",
          linkLabel: "新規登録",
          href: next ? `/signup?next=${encodeURIComponent(next)}` : "/signup",
        }}
      />
    </section>
  );
}
