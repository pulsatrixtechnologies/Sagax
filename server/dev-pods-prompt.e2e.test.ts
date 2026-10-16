import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WireBot } from "../shared/wire.ts";
import { DEV_PODS_PROMPT } from "./dev-pods-prompt.ts";

it("tells the bot about the coding view only on a send from a device where it is on", async () => {
  const fixture = await launchVerificationServer();
  const control = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
  const api = async <T>(path: string, method = "GET", body?: unknown, status?: number): Promise<T> => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (status !== undefined) expect(response.status).toBe(status);
    return response.json() as Promise<T>;
  };
  // Read only the synthetic engine's system text, never its environment.
  const sentSystem = () => (JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { systemPrompt: string }).systemPrompt;
  const send = async (bot: WireBot, text: string, extra: Record<string, unknown> = {}) => {
    await api(`/api/bots/${bot.id}/messages`, "POST", { text, threadId: bot.threadId, ...extra });
    expect(await control("wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30")).toMatchObject({ status: "settled" });
  };
  try {
    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Coding view fixture" }, 201);
    await send(bot, "Turn on coding mode.", { devPods: "on" });
    expect(sentSystem()).toContain(DEV_PODS_PROMPT);
    await send(bot, "Hello again.");
    expect(sentSystem()).not.toContain(DEV_PODS_PROMPT);
    await send(bot, "And now?", { devPods: "off" });
    expect(sentSystem()).not.toContain(DEV_PODS_PROMPT);
  } finally {
    await fixture.close();
  }
}, 90_000);
