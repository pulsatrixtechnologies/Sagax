import { describe, expect, it } from "vitest";
import {
  CLOUD_AGENT_READ_TOOLS,
  CLOUD_AGENT_WRITE_TOOLS,
  cloudAgentStatusActive,
  cloudAgentToolAction,
  normalizeCloudAgentStatus,
} from "./cloud-agents.ts";

describe("cloud-agents shared", () => {
  it("maps catalog tools to internal actions", () => {
    expect(cloudAgentToolAction("launch_cloud_agent")).toBe("launch");
    expect(cloudAgentToolAction("list_cloud_agents")).toBe("list");
    expect(cloudAgentToolAction("nope")).toBeNull();
  });

  it("partitions read and write tools", () => {
    for (const name of CLOUD_AGENT_READ_TOOLS) {
      expect(CLOUD_AGENT_WRITE_TOOLS.has(name)).toBe(false);
      expect(cloudAgentToolAction(name)).toBeTruthy();
    }
    for (const name of CLOUD_AGENT_WRITE_TOOLS) {
      expect(CLOUD_AGENT_READ_TOOLS.has(name)).toBe(false);
    }
  });

  it("normalizes provider statuses", () => {
    expect(normalizeCloudAgentStatus("RUNNING")).toBe("running");
    expect(normalizeCloudAgentStatus("SUCCEEDED")).toBe("finished");
    expect(cloudAgentStatusActive("running")).toBe(true);
    expect(cloudAgentStatusActive("finished")).toBe(false);
  });
});
