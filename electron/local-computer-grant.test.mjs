import { describe, expect, it } from "vitest";

import { createLocalComputerGrant, LOCAL_COMPUTER_MESSAGE } from "./local-computer-grant.mjs";

function child() {
  const sent = [];
  return { sent, postMessage(message) { sent.push(message); } };
}

describe("local computer handoff to the app's own server", () => {
  it("sends the current connection when the child spawns, then every change", () => {
    let current = { mode: "embedded", mcpCommand: "/driver" };
    const grant = createLocalComputerGrant({ current: () => current });
    const proc = child();
    grant.attach(proc);
    expect(proc.sent).toEqual([{ type: LOCAL_COMPUTER_MESSAGE, connection: current }]);
    current = { mode: "unavailable", reason: "stopped" };
    grant.changed(current);
    expect(proc.sent.at(-1)).toEqual({ type: LOCAL_COMPUTER_MESSAGE, connection: current });
  });

  it("says there is none before the driver started", () => {
    const grant = createLocalComputerGrant({ current: () => null });
    const proc = child();
    grant.attach(proc);
    expect(proc.sent).toEqual([{ type: LOCAL_COMPUTER_MESSAGE, connection: null }]);
  });

  it("never sends to a child that exited or was replaced", () => {
    let live = null;
    const grant = createLocalComputerGrant({ current: () => null, isCurrent: (proc) => proc === live });
    const old = child();
    const replacement = child();
    live = old;
    grant.attach(old);
    grant.detach(old);
    live = replacement;
    grant.attach(replacement);
    grant.changed({ mode: "embedded" });
    expect(old.sent).toHaveLength(1);
    expect(replacement.sent).toHaveLength(2);
  });

  it("survives a child whose port already closed", () => {
    const lines = [];
    const grant = createLocalComputerGrant({ current: () => null, log: (line) => lines.push(line) });
    expect(grant.attach({ postMessage() { throw new Error("closed"); } })).toBe(false);
    expect(lines[0]).toContain("closed");
  });
});
