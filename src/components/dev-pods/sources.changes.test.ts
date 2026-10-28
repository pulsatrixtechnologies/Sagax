import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { devChanges } from "./sources";

const tool = (summary: string, output: string): Message => ({ id: "m", role: "bot", kind: "activity", at: 1, tool: { name: "Bash", ok: true, summary, output } });

describe("pull request state", () => {
  it("reads the state from the bot's own command, newest first", () => {
    const messages = [
      tool("gh pr create --title \"Login fix\"", "https://github.com/acme/app/pull/42"),
      tool("gh pr merge 42", "https://github.com/acme/app/pull/42"),
    ];
    expect(devChanges(messages)[0]).toMatchObject({ number: 42, action: "merged", title: "Login fix" });
  });

  it("says nothing about a pull request only linked, never acted on", () => {
    const linked: Message = { id: "m", role: "bot", kind: "text", text: "See https://github.com/acme/app/pull/7", at: 1 };
    expect(devChanges([linked])[0]?.action).toBeUndefined();
  });

  it("reads closed and updated the same way", () => {
    expect(devChanges([tool("gh pr close 3", "https://github.com/acme/app/pull/3")])[0]?.action).toBe("closed");
    expect(devChanges([tool("gh pr ready 5", "https://github.com/acme/app/pull/5")])[0]?.action).toBe("updated");
  });
});
