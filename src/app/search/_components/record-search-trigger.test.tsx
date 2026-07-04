// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchCriteria } from "../_lib/build-search-query";

const { recordSearch } = vi.hoisted(() => ({
  recordSearch: vi.fn<(criteria: SearchCriteria) => Promise<void>>(),
}));
vi.mock("../_actions/record-search", () => ({ recordSearch }));

import { RecordSearchTrigger } from "./record-search-trigger";

afterEach(cleanup);
beforeEach(() => {
  recordSearch.mockReset();
  recordSearch.mockResolvedValue(undefined);
});

function criteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return { tagNames: [], page: 1, ...overrides };
}

describe("RecordSearchTrigger", () => {
  it("マウント時に recordSearch を criteria で呼ぶ", async () => {
    const c = criteria({ q: "獺祭" });
    render(<RecordSearchTrigger criteria={c} />);
    await waitFor(() => expect(recordSearch).toHaveBeenCalledWith(c));
  });

  it("ページだけ変わった再検索では再記録しない（同一検索の続き）", async () => {
    const { rerender } = render(
      <RecordSearchTrigger criteria={criteria({ q: "獺祭", page: 1 })} />,
    );
    await waitFor(() => expect(recordSearch).toHaveBeenCalledTimes(1));
    rerender(
      <RecordSearchTrigger criteria={criteria({ q: "獺祭", page: 2 })} />,
    );
    expect(recordSearch).toHaveBeenCalledTimes(1);
  });

  it("条件が変われば再記録する（別の検索イベント）", async () => {
    const { rerender } = render(
      <RecordSearchTrigger criteria={criteria({ q: "獺祭" })} />,
    );
    await waitFor(() => expect(recordSearch).toHaveBeenCalledTimes(1));
    rerender(<RecordSearchTrigger criteria={criteria({ q: "久保田" })} />);
    await waitFor(() => expect(recordSearch).toHaveBeenCalledTimes(2));
  });
});
