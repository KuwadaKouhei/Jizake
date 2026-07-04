import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  parseCredentials,
} from "./validation";

describe("parseCredentials", () => {
  it("正しいメールとパスワードを受理し trim する", () => {
    const result = parseCredentials({
      email: "  user@example.com  ",
      password: "secret123",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
      expect(result.data.password).toBe("secret123");
    }
  });

  it("メール未入力を弾く", () => {
    const result = parseCredentials({ email: "", password: "secret123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("メールアドレス");
    }
  });

  it("メール形式が不正なものを弾く", () => {
    const result = parseCredentials({
      email: "not-an-email",
      password: "secret123",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("形式");
    }
  });

  it("最小長未満のパスワードを弾く", () => {
    const short = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    const result = parseCredentials({
      email: "user@example.com",
      password: short,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(`${PASSWORD_MIN_LENGTH}文字以上`);
    }
  });

  it("最小長ちょうどのパスワードは受理する", () => {
    const ok = "a".repeat(PASSWORD_MIN_LENGTH);
    const result = parseCredentials({
      email: "user@example.com",
      password: ok,
    });
    expect(result.success).toBe(true);
  });

  it("最大長超過のパスワードを弾く", () => {
    const long = "a".repeat(PASSWORD_MAX_LENGTH + 1);
    const result = parseCredentials({
      email: "user@example.com",
      password: long,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(`${PASSWORD_MAX_LENGTH}文字以内`);
    }
  });

  it("非文字列入力（数値・null）を安全に弾く", () => {
    const result = parseCredentials({ email: 123, password: null });
    expect(result.success).toBe(false);
  });
});
