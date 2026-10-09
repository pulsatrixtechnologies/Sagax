import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

// A turn stamps the model and effort it ran on onto the bot text it writes,
// so the chat can say so under the reply. The stamp is an optional field of
// the message: nothing to migrate, and an older reply simply has none.
it("stores the model and effort a turn ran on, and none when the effort was the default", async () => {
  const fixture = await launchVerificationServer();
  try {
    const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${fixture.info.url}${path}`, {
        method, headers: { "content-type": "application/json", origin: fixture.info.url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json() as any;
      expect(response.ok, JSON.stringify(result)).toBe(true);
      return result;
    };
    const claude = (await control(["models"])).instances.find((item: any) => item.instanceId === "claude");
    const model: string = claude.models.options[0].id;
    const effort: string = claude.capabilities.effortLevels[0];
    const { bot } = await api("POST", "/api/bots", { name: "Run stamp", modelSelection: { instanceId: "claude", model, effort } });
    const lastReply = async () => {
      const { messages } = await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`);
      return (messages as any[]).findLast((message) => message.role === "bot" && message.kind === "text");
    };
    const turn = async (text: string) => {
      await control(["send", "--bot", bot.id, "--task", bot.threadId, "--text", text]);
      expect((await control(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"])).status).toBe("settled");
    };

    await turn("First, with an effort set.");
    expect((await lastReply()).turnRun).toEqual({ instanceId: "claude", model, effort });

    await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { modelSelection: { instanceId: "claude", model }, updateBotDefault: true });
    await turn("Second, on the engine default.");
    const second = await lastReply();
    expect(second.turnRun).toEqual({ instanceId: "claude", model });
    expect("effort" in second.turnRun).toBe(false);
  } finally {
    await fixture.close();
  }
}, 90_000);
