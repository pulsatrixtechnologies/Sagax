import { describe, expect, it } from "vitest";
import { bundledNotesFor, bundledNotesSince, bundledReleaseCatalog, bundledVersions } from "./bundled-release-notes";

describe("bundledReleaseCatalog", () => {
  it("bundles the shipped release notes, including 0.4.4", () => {
    const catalog = bundledReleaseCatalog();
    expect(catalog["0.4.4"]).toContain("## English");
    expect(catalog["0.4.6"]).toContain("## English");
    expect(catalog["0.4.8"]).toContain("## English");
    expect(catalog["0.4.9"]).toContain("## English");
    expect(catalog["0.4.10"]).toContain("## English");
    expect(catalog["0.4.11"]).toContain("## English");
    expect(catalog["0.4.12"]).toContain("## English");
    expect(catalog["0.4.13"]).toContain("## English");
    expect(catalog["0.4.14"]).toContain("## English");
    expect(catalog["0.4.15"]).toContain("## English");
    expect(catalog["0.4.16"]).toContain("## English");
    expect(catalog["0.4.17"]).toContain("## English");
    expect(catalog["0.4.18"]).toContain("## English");
    expect(catalog["0.4.19"]).toContain("## English");
    expect(catalog["0.4.22"]).toContain("## English");
    expect(catalog["0.5.0"]).toContain("## English");
    expect(catalog["0.5.1"]).toContain("## English");
    expect(catalog["0.5.2"]).toContain("## English");
    expect(catalog["0.5.2"]).toMatch(/allumé volontairement/);
    expect(catalog["0.5.2"]).toMatch(/enabled it on purpose/);
    expect(catalog["0.5.2"]).toContain("SAGAX_BOOT_ENGINE_SLOTS");
    expect(catalog["0.5.2"]).toContain("SAGAX_SANDBOX_K8S_NODE_SELECTOR");
    expect(catalog["0.5.2"]).toContain("SAGAX_SANDBOX_K8S_WAKE_URL");
    expect(catalog["0.5.3"]).toContain("## English");
    expect(catalog["0.5.3"]).toMatch(/Menus simplifiés/);
    expect(catalog["0.5.3"]).toMatch(/Simpler menus/);
    expect(catalog["0.5.3"]).toMatch(/Permissions des bots/);
    expect(catalog["0.5.3"]).toMatch(/Bot permissions/);
    expect(catalog["0.5.3"]).toMatch(/Agents temporaires/);
    expect(catalog["0.5.3"]).toMatch(/Temporary agents/);
    expect(catalog["0.5.4"]).toContain("## English");
    expect(catalog["0.5.4"]).toMatch(/Utilisation/);
    expect(catalog["0.5.4"]).toMatch(/Usage/);
    expect(Object.keys(catalog).sort()).toEqual(["0.4.0", "0.4.1", "0.4.10", "0.4.11", "0.4.12", "0.4.13", "0.4.14", "0.4.15", "0.4.16", "0.4.17", "0.4.18", "0.4.19", "0.4.2", "0.4.20", "0.4.21", "0.4.22", "0.4.3", "0.4.4", "0.4.5", "0.4.6", "0.4.7", "0.4.8", "0.4.9", "0.5.0", "0.5.1", "0.5.2", "0.5.3", "0.5.4"]);
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

describe("version browsing", () => {
  const catalog = {
    "0.9.0": "Neuf\n\n## English\n\nNine",
    "0.10.0": "Dix\n\n## English\n\nTen",
    "0.2.0": "Only French here",
  };

  it("lists versions newest first by semver, not by string", () => {
    expect(bundledVersions(catalog)).toEqual(["0.10.0", "0.9.0", "0.2.0"]);
  });

  it("lists the real bundle newest first with the running release on top", () => {
    const versions = bundledVersions();
    expect(versions[0]).toBe("0.5.4");
    expect(versions.at(-1)).toBe("0.4.0");
  });

  it("renders the chosen file in the UI language, and falls back when there is no English section", () => {
    expect(bundledNotesFor("0.9.0", "fr", catalog)).toBe("Neuf");
    expect(bundledNotesFor("0.9.0", "en", catalog)).toBe("Nine");
    expect(bundledNotesFor("0.10.0", "pt-BR", catalog)).toBe("Ten");
    expect(bundledNotesFor("0.2.0", "en", catalog)).toBe("Only French here");
  });

  it("collects the changes after the previous version up to the current one", () => {
    expect(bundledNotesSince("0.2.0", "0.9.0", catalog).map((entry) => entry.version)).toEqual(["0.9.0"]);
    expect(bundledNotesSince("0.2.0", "0.10.0", catalog).map((entry) => entry.version)).toEqual(["0.10.0", "0.9.0"]);
    expect(bundledNotesSince("0.10.0", "0.10.0", catalog)).toEqual([]);
  });
});
