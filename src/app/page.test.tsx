// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "./page";

function renderHome() {
  const markup = renderToStaticMarkup(<Home />);
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("Home", () => {
  it("実装済みの都道府県別一覧（/prefectures）への導線を表示する（T06）", () => {
    const doc = renderHome();

    const link = doc.querySelector('a[href="/prefectures"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("都道府県から地酒を探す");
  });
});
