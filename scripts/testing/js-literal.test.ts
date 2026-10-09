import { describe, expect, it } from "vitest";
import { jsLiteral } from "./js-literal.mjs";

describe("jsLiteral", () => {
  it("evaluates back to the same value", () => {
    for (const value of ["plain", "</script><b>", "a\u2028b\u2029c", "line\nbreak\t\0", 'quote " \\ back', 42, null, true, { a: ["<x>", 1] }]) {
      expect(new Function(`return ${jsLiteral(value)};`)()).toEqual(value);
    }
  });

  it("leaves no raw markup or line separators in the source", () => {
    const source = jsLiteral("</script>\u2028<!--");
    expect(source).not.toMatch(/[<>\u2028\u2029]/);
  });

  it("keeps undefined as undefined", () => {
    expect(jsLiteral(undefined)).toBe("undefined");
  });
});
