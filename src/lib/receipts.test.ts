import { describe, expect, it } from "vitest";

import { lastNonReceipt } from "./receipts";

describe("lastNonReceipt", () => {
  it("reads past digests, compactions and a stored stop notice", () => {
    const reply = { kind: "text", text: "done" };
    const stopped = { kind: "activity", tool: { name: "error: turn stopped", ok: false } };
    expect(lastNonReceipt([reply, stopped, { kind: "digest" }, { kind: "compaction" }])).toBe(reply);
  });

  it("reads past the hidden On your computer line, never past the cloud one", () => {
    const reply = { kind: "text", text: "done" };
    const here = { kind: "activity", tool: { name: "notice: Workspace: On your computer", ok: true } };
    const cloud = { kind: "activity", tool: { name: "notice: Workspace: In the cloud", ok: true } };
    expect(lastNonReceipt([reply, here])).toBe(reply);
    expect(lastNonReceipt([reply, cloud])).toBe(cloud);
  });

  it("keeps a real failure as the last row", () => {
    const failure = { kind: "activity", tool: { name: "error: engine missing", ok: false } };
    expect(lastNonReceipt([{ kind: "text" }, failure])).toBe(failure);
  });
});
