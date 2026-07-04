import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { signUp } from "@/lib/auth/actions";
import { resolveAfterLogin, sanitizeRedirectPath } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/server";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/validation";

export const metadata: Metadata = {
  title: "新規登録",
  description: "Jizake のアカウントを作成して閲覧・検索の履歴を利用する。",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

export default async function SignupPage({ searchParams }: PageProps) {
  const { next: rawNext } = await searchParams;
  const next = sanitizeRedirectPath(
    Array.isArray(rawNext) ? rawNext[0] : rawNext,
  );

  const user = await getCurrentUser();
  if (user) {
    redirect(resolveAfterLogin(next));
  }

  return (
    <section className="mx-auto w-full max-w-sm flex-1 px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">新規登録</h1>
      <AuthForm
        action={signUp}
        submitLabel="登録する"
        next={next ?? undefined}
        passwordHint={`パスワードは${PASSWORD_MIN_LENGTH}文字以上で設定してください。`}
        altPrompt={{
          text: "既にアカウントをお持ちの方は",
          linkLabel: "ログイン",
          href: next ? `/login?next=${encodeURIComponent(next)}` : "/login",
        }}
      />
    </section>
  );
}
