// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteFooter } from "@/components/site-footer";

afterEach(cleanup);

describe("SiteFooter", () => {
  it("さけのわデータへの帰属リンク（https://sakenowa.com）がある", () => {
    render(<SiteFooter />);

    const link = screen.getByRole("link", { name: "さけのわデータ" });

    expect(link.getAttribute("href")).toBe("https://sakenowa.com");
  });

  it("帰属リンクは別タブで安全に開く（target=_blank / rel=noopener）", () => {
    render(<SiteFooter />);

    const link = screen.getByRole("link", { name: "さけのわデータ" });

    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("さけのわデータ利用の表記文言が表示される", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");

    expect(footer.textContent).toContain("このサイトは");
    expect(footer.textContent).toContain("さけのわデータ");
    expect(footer.textContent).toContain("を利用しています。");
  });
});
