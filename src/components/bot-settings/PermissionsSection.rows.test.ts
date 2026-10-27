import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Email drafts row once used the bare SwitchRow, which has no row
// padding or help button, so it sat against the card edge. Every row of
// the Approvals card is a DescribedRow with the shared Switch.
describe("PermissionsSection approvals rows", () => {
  const source = readFileSync(new URL("./PermissionsSection.tsx", import.meta.url), "utf8");
  const drafts = source.slice(source.indexOf("{showDrafts && ("), source.indexOf("{showHooks &&"));

  it("draws Email drafts as a DescribedRow with a help tip and the shared Switch", () => {
    expect(drafts).toContain("<DescribedRow");
    expect(drafts).toContain("help={t(\"botPanel.emailDrafts.help\")}");
    expect(drafts).toContain("<Switch");
    expect(drafts).not.toContain("<SwitchRow");
  });
});
