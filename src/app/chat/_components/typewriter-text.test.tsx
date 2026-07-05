// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TypewriterText } from "./typewriter-text";

/**
 * タイプライター表示のユニットテスト。
 *
 * - active=false（生成完了・過去発話）は最初から全文を同期表示する
 *   （既存の chat-messages テストが status=ready でこの経路を通る前提を固定）。
 * - active=true（生成中）は最初は全文を出さない（0 文字から現れ始める）。
 *
 * jsdom には matchMedia が無いため prefersReducedMotion は false 扱いになる
 * （＝アニメ経路が有効）。時間経過そのものは検証せず、初期状態のみ固定する。
 */
afterEach(cleanup);

describe("TypewriterText", () => {
  it("active=false は全文を即時表示する", () => {
    const { container } = render(
      <TypewriterText
        text="こんばんは、日本酒を探しましょう。"
        active={false}
      />,
    );
    expect(container.textContent).toBe("こんばんは、日本酒を探しましょう。");
  });

  it("active=true は初期状態で全文を出さない（タイプ開始前）", () => {
    const full = "こんばんは、日本酒を探しましょう。";
    const { container } = render(<TypewriterText text={full} active />);
    // 本文はまだ全部は出ていない（キャレット等を除いても全文未満）。
    expect(container.textContent?.includes(full)).toBe(false);
  });

  it("`**〜**` は <strong> で表示し、記号は出さない", () => {
    const { container } = render(
      <TypewriterText text="おすすめは **辛口** です" active={false} />,
    );
    expect(container.textContent).toBe("おすすめは 辛口 です");
    expect(container.textContent).not.toContain("**");
    expect(container.querySelector("strong")?.textContent).toBe("辛口");
  });
});
