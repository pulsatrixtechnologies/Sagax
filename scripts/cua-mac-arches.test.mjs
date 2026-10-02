import { describe, expect, it } from "vitest";
import { DEFAULT_MAC_ARCHES, resolveCuaMacArches } from "./cua-mac-arches.mjs";

describe("resolveCuaMacArches", () => {
  it("defaults to both packaging targets", () => {
    expect(resolveCuaMacArches({})).toEqual(DEFAULT_MAC_ARCHES);
  });

  it("rejects an empty override even when PARTIAL=1", () => {
    expect(() => resolveCuaMacArches({ SAGAX_CUA_ARCHES: "", SAGAX_CUA_ARCHES_PARTIAL: "1" })).toThrow(
      /SAGAX_CUA_ARCHES is empty/,
    );
    expect(() => resolveCuaMacArches({ SAGAX_CUA_ARCHES: " , ", SAGAX_CUA_ARCHES_PARTIAL: "1" })).toThrow(
      /SAGAX_CUA_ARCHES is empty/,
    );
  });

  it("rejects a one-arch override unless PARTIAL=1", () => {
    expect(() => resolveCuaMacArches({ SAGAX_CUA_ARCHES: "arm64" })).toThrow(/omits x64/);
    expect(resolveCuaMacArches({ SAGAX_CUA_ARCHES: "arm64", SAGAX_CUA_ARCHES_PARTIAL: "1" })).toEqual([
      "arm64",
    ]);
  });
});
