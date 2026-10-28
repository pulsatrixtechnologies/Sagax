import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json";

describe("canonicalJson", () => {
  it("sorts keys and drops undefined, including inside arrays", () => {
    expect(canonicalJson({ b: 1, a: [3, { d: undefined, c: "x" }], e: undefined })).toBe('{"a":[3,{"c":"x"}],"b":1}');
  });

  it("does not depend on key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("turns a non-JSON leaf into null rather than a hole", () => {
    expect(canonicalJson({ f: undefined, n: null })).toBe('{"n":null}');
    expect(canonicalJson([undefined])).toBe("[null]");
  });
});
