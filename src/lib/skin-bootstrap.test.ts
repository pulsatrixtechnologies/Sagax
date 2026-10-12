import { describe, expect, it } from "vitest";
import { escapeUnsafeChars, skinBootstrapInlineScript, skinIdFromStored } from "./skin-bootstrap";

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

  it("escapes characters that would break out of the inline script", () => {
    const escaped = escapeUnsafeChars(JSON.stringify("</script>\u2028\u2029"));
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
    expect(escaped).not.toContain("/");
    expect(escaped).not.toContain("\u2028");
    expect(escaped).not.toContain("\u2029");
    expect(escaped).toContain("\\u003C");
    expect(escaped).toContain("\\u003E");
    expect(escaped).toContain("\\u002F");
    expect(escaped).toContain("\\u2028");
    expect(escaped).toContain("\\u2029");
  });
});
