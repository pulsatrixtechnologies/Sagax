import { describe, expect, it } from "vitest";
import { ULTRACODE_EFFORT } from "../../shared/ultracode-effort";
import { effortLabel } from "./effort-label";

describe("effortLabel", () => {
  it("labels ultracode from i18n", () => {
    expect(effortLabel(ULTRACODE_EFFORT)).toBe("Ultracode");
  });

  it("capitalizes ordinary levels", () => {
    expect(effortLabel("high")).toBe("High");
    expect(effortLabel("xhigh")).toBe("X-High");
  });
});
