// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordView } = vi.hoisted(() => ({
  recordView: vi.fn<(sakeId: string) => Promise<void>>(),
}));
vi.mock("../_actions/record-view", () => ({ recordView }));

import { RecordViewTrigger } from "./record-view-trigger";

afterEach(cleanup);
beforeEach(() => {
  recordView.mockReset();
  recordView.mockResolvedValue(undefined);
});

const SAKE_ID = "d1111111-1111-4111-8111-111111111111";

describe("RecordViewTrigger", () => {
  it("マウント時に recordView を sakeId で呼ぶ（fire-and-forget）", async () => {
    render(<RecordViewTrigger sakeId={SAKE_ID} />);
    await waitFor(() => expect(recordView).toHaveBeenCalledWith(SAKE_ID));
  });

  it("同一 sakeId の再レンダリングで二重記録しない", async () => {
    const { rerender } = render(<RecordViewTrigger sakeId={SAKE_ID} />);
    await waitFor(() => expect(recordView).toHaveBeenCalledTimes(1));
    rerender(<RecordViewTrigger sakeId={SAKE_ID} />);
    expect(recordView).toHaveBeenCalledTimes(1);
  });

  it("Server Action が reject しても例外を投げない（表示を壊さない）", async () => {
    recordView.mockRejectedValue(new Error("boom"));
    expect(() => render(<RecordViewTrigger sakeId={SAKE_ID} />)).not.toThrow();
    await waitFor(() => expect(recordView).toHaveBeenCalled());
  });

  it("何も描画しない（副作用マーカー）", () => {
    const { container } = render(<RecordViewTrigger sakeId={SAKE_ID} />);
    expect(container.innerHTML).toBe("");
  });
});
