// The versioned test quarantine. A test that fails for a reason we have not
// fixed yet is skipped ONLY through an entry here: where (platforms), why,
// the tracking issue, and an expiry date. scripts/testing/quarantine.test.ts
// fails CI the day an entry expires, so a quarantine is a dated debt, never a
// silent skip. Fix the test (or the product) and delete the entry; extend an
// expiry only with a note on the issue saying why.
//
// Use: it.skipIf(quarantined("<id>"))("...", ...) or describe.skipIf(...).

export interface QuarantineEntry {
  id: string;
  file: string;
  test: string;
  /** process.platform values the test is skipped on */
  platforms: NodeJS.Platform[];
  reason: string;
  issue: string;
  /** YYYY-MM-DD; CI fails from this day on */
  expires: string;
}

export const QUARANTINE: readonly QuarantineEntry[] = [
  {
    id: "mcp-gate-approval-windows",
    file: "server/mcp-gate-approval.test.ts",
    test: "mcp-gate approval (whole suite)",
    platforms: ["win32"],
    reason: "beforeEach times out: the broker listens on a Unix socket path, not a Windows named pipe",
    issue: "https://github.com/pulsatrixtechnologies/Sagax/issues/345",
    expires: "2026-11-09",
  },
  {
    id: "archive-attachments-windows",
    file: "server/archive-attachments.e2e.test.ts",
    test: "unpacks a zip next to the upload and tells the bot what is inside, in a chat and in a group",
    platforms: ["win32"],
    reason: "the turn prompt never carries attached-archive with a Windows upload path",
    issue: "https://github.com/pulsatrixtechnologies/Sagax/issues/346",
    expires: "2026-11-09",
  },
  {
    id: "acp-qwen-stop-windows",
    file: "server/drivers/acp/acp.test.ts",
    test: "does not load or prompt Qwen after Stop during old-process cleanup",
    platforms: ["win32"],
    reason: "timing race with old-process cleanup; the turn completes before Stop lands",
    issue: "https://github.com/pulsatrixtechnologies/Sagax/issues/347",
    expires: "2026-11-09",
  },
];

/** True when the entry applies on this platform: skip the test. */
export function quarantined(id: string, platform: NodeJS.Platform = process.platform): boolean {
  const entry = QUARANTINE.find((each) => each.id === id);
  if (!entry) throw new Error(`No quarantine entry "${id}" in scripts/testing/quarantine.ts`);
  return entry.platforms.includes(platform);
}
