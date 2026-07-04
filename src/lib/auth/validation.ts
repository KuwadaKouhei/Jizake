import { z } from "zod";

/**
 * 認証フォーム入力のバリデーション（境界での型厳格化。CODING_PHILOSOPHY 原則2）。
 *
 * Server Actions はここで Zod 検証してから Supabase へ渡す（クライアント入力を信用しない）。
 * スキーマと整形を純関数として分離し、ユニットテスト対象にする（TEST_PHILOSOPHY）。
 */

/** パスワード最小長。Supabase Auth の既定（6）に合わせる。 */
export const PASSWORD_MIN_LENGTH = 6;
/** パスワード最大長（極端に長い入力を境界で弾く。bcrypt の実効上限も考慮）。 */
export const PASSWORD_MAX_LENGTH = 72;

export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "メールアドレスを入力してください")
    .pipe(z.email("メールアドレスの形式が正しくありません")),
  password: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`,
    )
    .max(
      PASSWORD_MAX_LENGTH,
      `パスワードは${PASSWORD_MAX_LENGTH}文字以内で入力してください`,
    ),
});

export type Credentials = z.infer<typeof credentialsSchema>;

export type ValidationResult =
  { success: true; data: Credentials } | { success: false; error: string };

/**
 * FormData 相当の生入力から認証情報を検証する。
 *
 * 失敗時は最初のエラーメッセージ 1 件をユーザー向け文言として返す
 * （フォーム下部に単一エラー表示するため）。
 */
export function parseCredentials(input: {
  email: unknown;
  password: unknown;
}): ValidationResult {
  const result = credentialsSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      success: false,
      error: first?.message ?? "入力内容が正しくありません",
    };
  }
  return { success: true, data: result.data };
}
