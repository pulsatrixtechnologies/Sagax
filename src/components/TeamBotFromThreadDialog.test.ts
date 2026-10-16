// The Team Bot dialog's choices: plugins and connectors ticked, memory off
// until the person ticks it, and then exactly what is listed goes.
import { describe, expect, it } from "vitest";

import { carryRequest, initialCarryChoices, memoryGoing } from "./TeamBotFromThreadDialog";

const plugins = [
  { key: "a@m", name: "a", marketplace: "m", enabled: true },
  { key: "b@m", name: "b", marketplace: "m", enabled: false },
];
const notes = [{ path: "MEMORY.md" }, { path: "memory/clients.md" }];

describe("Team Bot from a conversation", () => {
  it("starts with memory off, enabled plugins and every connector ticked", () => {
    const choices = initialCarryChoices({ plugins, connectors: ["linear"], notes });
    expect(choices.includeMemory).toBe(false);
    expect([...choices.plugins]).toEqual(["a@m"]);
    expect([...choices.connectors]).toEqual(["linear"]);
  });

  it("sends no memory request and lists nothing while memory is off", () => {
    const choices = initialCarryChoices({ plugins, connectors: [], notes });
    expect(memoryGoing(choices, "memory/conversation-carry-over.md")).toEqual([]);
    expect(carryRequest(choices, "t1", "neo")).toBeNull();
  });

  it("once ticked, lists and sends exactly the chosen notes and the summary", () => {
    const choices = { ...initialCarryChoices({ plugins, connectors: [], notes }), includeMemory: true };
    choices.notes.delete("MEMORY.md");
    expect(memoryGoing(choices, "memory/conversation-carry-over.md")).toEqual(["memory/clients.md", "memory/conversation-carry-over.md"]);
    expect(carryRequest(choices, "t1", "neo")).toEqual({ threadId: "t1", newBotId: "neo", includeMemory: true, notes: ["memory/clients.md"], summary: true });
  });
});
