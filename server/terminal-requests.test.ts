import { beforeEach, describe, expect, it } from "vitest";

import { terminalRequestBehavior } from "../shared/terminal-request.ts";
import { DATA_DIR } from "./config.ts";
import { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import { testTerminalAdapter } from "./terminal-resources/adapters/test.ts";
import { createTerminalAuditLog } from "./terminal-audit.ts";
import { createTerminalSessionManager } from "./terminal-sessions.ts";
import { createTerminalRequestService } from "./terminal-requests.ts";
import type { Store, Message } from "./store.ts";

describe("terminalRequestBehavior", () => {
  it("allows the Québec label only", () => {
    expect(terminalRequestBehavior("Ouvrir un terminal")).toBe("allow");
    expect(terminalRequestBehavior("Refuser")).toBe("deny");
  });
});

describe("terminal request service", () => {
  const threadId = "thread-1";
  const botId = "bot-1";
  let messages: Message[];

  beforeEach(() => {
    messages = [];
    process.env.SAGAX_TERMINAL_TEST = "1";
  });

  it("opens a session after allow", async () => {
    const registry = new TerminalResourceRegistry();
    registry.register(testTerminalAdapter);
    const audit = createTerminalAuditLog(DATA_DIR);
    const sessions = createTerminalSessionManager({ registry, audit, now: () => 1_700_000_000_000 });
    const store = {
      bot: () => ({ id: botId, name: "T", color: "#336699" }),
      taskByThread: () => ({ ownerPrincipalId: "pr_test" }),
      messagesFor: () => messages,
      appendMessage: (_thread: string, partial: Partial<Message>) => {
        const message = { id: `m${messages.length}`, at: 1, role: "bot", kind: "text", ...partial } as Message;
        messages.push(message);
        return message;
      },
      patchMessage: (_thread: string, id: string, patch: Partial<Message>) => {
        const row = messages.find((m) => m.id === id);
        if (row && patch.card) row.card = { ...row.card!, ...patch.card };
      },
    } as unknown as Store;
    const requests = createTerminalRequestService({
      store,
      registry,
      sessions,
      principalId: () => "pr_test",
      audit,
      now: () => 1_700_000_000_000,
    });
    const submitted = await requests.submit({
      botId,
      threadId,
      resourceId: "echo",
      provider: "test",
      reason: "Vérifier le disque",
      principalId: "pr_test",
    });
    expect("requestId" in submitted).toBe(true);
    if (!("requestId" in submitted)) return;
    const allowed = await requests.resolve({
      threadId,
      requestId: submitted.requestId,
      behavior: "allow",
      principalId: "pr_test",
    });
    expect(allowed).toMatchObject({ claimed: true, outcome: "allowed-once" });
    const embed = messages.find((m) => m.terminalEmbed)?.terminalEmbed;
    expect(embed?.sessionId).toBeTruthy();
    expect(embed?.provider).toBe("test");
  });
});
