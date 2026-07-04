/**
 * 認証リダイレクトの純関数（オープンリダイレクト防止・ルート保護判定）。
 *
 * middleware / ログインフォームから呼ぶ判定ロジックをここに集約し、
 * ユニットテスト対象にする（TEST_PHILOSOPHY: 分岐ロジックは純関数で厚く）。
 */

/** 認証が必須のルート（未ログインなら /login へ誘導する）。DESIGN §2.3: /history のみ。 */
export const PROTECTED_PREFIXES: readonly string[] = ["/history"];

/** ログイン後の既定の遷移先（安全な next が無いとき）。 */
export const DEFAULT_AFTER_LOGIN = "/";

/**
 * 与えられたパスが保護対象ルートか判定する。
 *
 * 完全一致または `/history/...` のような配下も保護する。`/historyx` のような
 * 別ルートを誤って保護しないよう、境界（次が `/` か終端）で判定する。
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * リダイレクト先（`next` / `returnTo`）がアプリ内の安全なパスか検証する。
 *
 * オープンリダイレクト対策（REVIEW T05 引き継ぎ・DESIGN §6.2）:
 * - 先頭が `/` の相対パスのみ許可する（`https://evil.example` 等の絶対 URL を弾く）。
 * - `//evil.example`（プロトコル相対 URL）やバックスラッシュ経由の回避を弾く。
 * - 制御文字を含むものを弾く。
 *
 * @returns 安全なら渡された値をそのまま、危険・空なら null
 */
export function sanitizeRedirectPath(
  target: string | null | undefined,
): string | null {
  if (typeof target !== "string" || target.length === 0) return null;

  // 相対パスのみ（先頭スラッシュ必須）
  if (!target.startsWith("/")) return null;

  // プロトコル相対 URL（//host）や `/\` によるスキーム回避を弾く
  if (target.startsWith("//") || target.startsWith("/\\")) return null;

  // バックスラッシュはブラウザによって `/` 扱いされ回避に使われるため弾く
  if (target.includes("\\")) return null;

  // 制御文字（改行・タブ・NUL 等 U+0000..U+001F）を含むものを弾く
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(target)) return null;

  return target;
}

/**
 * ログイン後の遷移先を決める。安全な next があればそこへ、無ければ既定へ。
 */
export function resolveAfterLogin(next: string | null | undefined): string {
  return sanitizeRedirectPath(next) ?? DEFAULT_AFTER_LOGIN;
}

/**
 * 未ログインで保護ルートへアクセスした際の /login へのリダイレクト先を組み立てる。
 * 元の遷移先を `?next=` に安全な形で保持する。
 */
export function buildLoginRedirect(pathname: string): string {
  const safe = sanitizeRedirectPath(pathname);
  if (!safe) return "/login";
  return `/login?next=${encodeURIComponent(safe)}`;
}
