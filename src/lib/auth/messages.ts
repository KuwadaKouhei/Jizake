/**
 * 認証エラーのユーザー向け文言（純関数）。
 *
 * Server Actions（"use server" は全 export が async 必須）から分離し、
 * ユニットテスト対象にする。Supabase の生メッセージを、情報漏洩を避けた
 * 汎用文言に正規化する（アカウント存在の推測を防ぐ・実装詳細を出さない）。
 */

/** 認証基盤が利用不可（環境変数未設定など）のときの文言。 */
export function authUnavailableMessage(): string {
  return "認証サービスが利用できません。時間をおいて再度お試しください。";
}

/**
 * ログイン失敗メッセージ。
 * メール不存在とパスワード誤りを区別しない（アカウント存在の推測を防ぐ）。
 */
export function signInErrorMessage(): string {
  return "メールアドレスまたはパスワードが正しくありません。";
}

/** サインアップ失敗メッセージ。既存メール等は Supabase 文言を汎用化する。 */
export function signUpErrorMessage(raw: string): string {
  if (/already registered|already exists|user already/i.test(raw)) {
    return "このメールアドレスは既に登録されています。";
  }
  return "登録に失敗しました。入力内容をご確認ください。";
}
