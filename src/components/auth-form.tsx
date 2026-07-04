"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AuthActionState } from "@/lib/auth/actions";

type AuthAction = (
  prevState: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;

type AuthFormProps = {
  /** signIn / signUp のいずれかの Server Action。 */
  action: AuthAction;
  /** 送信ボタンの文言（例: 「ログイン」「登録する」）。 */
  submitLabel: string;
  /** ログイン後の遷移先（保護ルートからの誘導時に保持）。安全性はサーバ側で再検証する。 */
  next?: string;
  /** 反対の画面への案内（例: 未登録なら新規登録へ）。 */
  altPrompt: { text: string; linkLabel: string; href: string };
  /** 新規登録フォームではパスワードの補足を出す。 */
  passwordHint?: string;
};

const INITIAL_STATE: AuthActionState = { error: null };

/**
 * 認証フォーム（ログイン・新規登録で共用）。
 *
 * Server Action を useActionState で呼び、返ってきたエラーをフォーム下部に表示する。
 * 成功時は Server Action 側が redirect するためここでは遷移を扱わない。
 * next は hidden で送るが、リダイレクト先の安全性検証はサーバ側で行う（多層防御）。
 */
export function AuthForm({
  action,
  submitLabel,
  next,
  altPrompt,
  passwordHint,
}: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="grid gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <label className="grid gap-1 text-sm">
        <span className="font-medium">メールアドレス</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          className="h-9 rounded-md border px-3 text-sm"
        />
      </label>

      <label className="grid gap-1 text-sm">
        <span className="font-medium">パスワード</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={6}
          className="h-9 rounded-md border px-3 text-sm"
        />
        {passwordHint ? (
          <span className="text-xs text-muted-foreground">{passwordHint}</span>
        ) : null}
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-60"
      >
        {pending ? "処理中…" : submitLabel}
      </button>

      <p className="text-sm text-muted-foreground">
        {altPrompt.text}{" "}
        <Link
          href={altPrompt.href}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {altPrompt.linkLabel}
        </Link>
      </p>
    </form>
  );
}
