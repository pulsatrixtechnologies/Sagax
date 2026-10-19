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
    const input = ["</script><b>", "a\u2028b\u2029c", "x\\/y"];
    const out = scriptSafeJson(input);
    expect(out).not.toMatch(/[<>/\u2028\u2029]/);
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(JSON.parse(out)).toEqual(input);
  });
});

describe("skin bootstrap under Auto", () => {
  function run(stored: Record<string, string>, dark: boolean): string | undefined {
    const root = { dataset: {} as Record<string, string> };
    const fn = new Function("localStorage", "matchMedia", "document", skinBootstrapInlineScript());
    fn({ getItem: (key: string) => stored[key] ?? null }, () => ({ matches: dark }), { documentElement: root });
    return root.dataset.skin;
  }

  it("swaps a paired skin for the system's scheme, and only under Auto", () => {
    expect(run({ "omb-skin": "midnight" }, false)).toBe("midnight");
    expect(run({ "omb-skin": "midnight", "omb-skin-mode": "auto" }, false)).toBe("daylight");
    expect(run({ "omb-skin": "atelier", "omb-skin-mode": "auto" }, true)).toBe("foundry");
    expect(run({ "omb-skin": "dusk", "omb-skin-mode": "auto" }, false)).toBe("dusk");
    expect(run({ "omb-skin-mode": "auto" }, false)).toBe("pulsatrix-light");
  });
});
