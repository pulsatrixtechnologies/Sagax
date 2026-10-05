import { describe, expect, it } from "vitest";
import { bundledNotesFor, bundledReleaseCatalog } from "./bundled-release-notes";

describe("bundledReleaseCatalog", () => {
  it("bundles the shipped release notes, including 0.4.4", () => {
    const catalog = bundledReleaseCatalog();
    expect(catalog["0.4.4"]).toContain("## English");
    expect(catalog["0.4.6"]).toContain("## English");
    expect(Object.keys(catalog).sort()).toEqual(["0.4.0", "0.4.1", "0.4.2", "0.4.3", "0.4.4", "0.4.5", "0.4.6"]);
  });

  it("reads a version from the file name and picks the language section", () => {
    const catalog = bundledReleaseCatalog({
      "/docs/releases/1.2.0.md": "Français\n\n## English\n\nEnglish text",
      "/docs/releases/notes.md": "ignored",
    });
    expect(bundledNotesFor("1.2.0", "fr", catalog)).toBe("Français");
    expect(bundledNotesFor("1.2.0", "ja", catalog)).toBe("English text");
    expect(bundledNotesFor("9.9.9", "en", catalog)).toBeNull();
  });
});
