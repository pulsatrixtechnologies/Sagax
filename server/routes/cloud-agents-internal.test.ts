import { describe, expect, it, vi } from "vitest";
import { handleCloudAgentInternal } from "./cloud-agents-internal.ts";
import type { CloudAgentManager } from "../cloud-agents/manager.ts";

describe("cloud-agents internal", () => {
  it("lists agents for the launching person only", async () => {
    const manager = {
      syncBot: vi.fn(async () => {}),
      list: vi.fn(() => [
        { id: "ca_a", principalId: "pr_alice", botId: "b1" },
        { id: "ca_b", principalId: "pr_bob", botId: "b1" },
      ]),
    } as unknown as CloudAgentManager;
    const answer = await handleCloudAgentInternal("list", {}, {
      manager,
      principalId: "pr_alice",
      botId: "b1",
      threadId: "t1",
    });
    expect(answer.text).toContain("ca_a");
    expect(answer.text).not.toContain("ca_b");
  });
});
