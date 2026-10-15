import { describe, expect, it } from "vitest";
import { scriptSafeJson, skinBootstrapInlineScript, skinIdFromStored } from "./skin-bootstrap";

describe("skin bootstrap before hydration", () => {
  it("reads the last cached skin id", () => {
    expect(skinIdFromStored("midnight")).toBe("midnight");
    expect(skinIdFromStored("nope")).toBe("pulsatrix");
    expect(skinIdFromStored(null)).toBe("pulsatrix");
  });

  it("ships an inline script that stamps data-skin from localStorage", () => {
    const script = skinBootstrapInlineScript();
    expect(script).toContain("omb-skin");
    expect(script).toContain("document.documentElement.dataset.skin");
    expect(script).toContain("midnight");
  });

  it("escapes script-breaking characters in embedded JSON", () => {
    const out = scriptSafeJson(["</script><b>", "a b c", "x\\/y"]);
    expect(out).not.toMatch(/[<>/  ]/);
    expect(JSON.parse(out)).toEqual(["</script><b>", "a b c", "x\\/y"]);
  });
});
