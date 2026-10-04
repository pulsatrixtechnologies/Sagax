import { describe, expect, it } from "vitest";
import { settingsLinkParts, settingsSectionLabel } from "./settings-link";
import { setLocale } from "@/lib/i18n";

describe("settings links", () => {
  it("names a section with the label Settings shows", () => {
    setLocale("en");
    expect(settingsSectionLabel("connections")).toBe("API keys");
    expect(settingsSectionLabel("companion")).toBe("Pair devices");
    expect(settingsSectionLabel("experimental")).toBe("Experimental");
    setLocale("fr");
    expect(settingsSectionLabel("connections")).toBe("Clés API");
    setLocale("en");
  });

  it("splits a sentence on its settings placeholders", () => {
    expect(settingsLinkParts("Check the key in {settings}.")).toEqual([
      { kind: "text", text: "Check the key in " },
      { kind: "link", name: "settings" },
      { kind: "text", text: "." },
    ]);
    expect(settingsLinkParts("No pointer here.")).toEqual([{ kind: "text", text: "No pointer here." }]);
    expect(settingsLinkParts("the card in {apiKeys}. While off, {providers}.")).toEqual([
      { kind: "text", text: "the card in " },
      { kind: "link", name: "apiKeys" },
      { kind: "text", text: ". While off, " },
      { kind: "link", name: "providers" },
      { kind: "text", text: "." },
    ]);
  });
});
