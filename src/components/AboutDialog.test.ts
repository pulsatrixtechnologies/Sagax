import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AboutDialog.tsx", import.meta.url), "utf8");

describe("AboutDialog links", () => {
  it("has a single release notes link and no Releases link", () => {
    expect(source.match(/releaseNotes\.menu/g)).toHaveLength(1);
    expect(source).toContain('requestReleaseNotes("browse")');
    expect(source).not.toMatch(/RELEASES_URL|label="Releases"/);
    const labels = [...source.matchAll(/<AboutLink [^>]*label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["GitHub", "Docs", "License"]);
  });
});
