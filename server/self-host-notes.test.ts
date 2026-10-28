import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("self-host notes", () => {
  it("offers a self-host issue template and a before-update section in both languages", () => {
    const template = readFileSync(join(root, ".github/ISSUE_TEMPLATE/self-host.yml"), "utf8");
    expect(template).toContain("name: Self-hosting");
    expect(template).toContain("removed keys");
    const notes = readFileSync(join(root, "docs/releases/0.8.5.md"), "utf8");
    expect(notes).toContain("## Avant de mettre à jour");
    expect(notes).toContain("## Before updating");
    const releasing = readFileSync(join(root, "docs/releasing.md"), "utf8");
    expect(releasing).toContain("Avant de mettre à jour");
    expect(releasing).toContain("Before updating");
  });
});
