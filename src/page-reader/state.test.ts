// The wrapper's side of a page's shared state (src/page-reader/state.ts).
import { describe, expect, it } from "vitest";

import { viewToken } from "./state";

describe("viewToken", () => {
  it("is the reading link's token only", () => {
    expect(viewToken("/pages/view/abc.def")).toBe("abc.def");
    expect(viewToken("/pages/preview/abc/1")).toBeNull();
    expect(viewToken("/pages/view/a/b")).toBeNull();
  });
});
