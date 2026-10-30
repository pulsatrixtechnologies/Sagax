import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("keeps a model off across selection, Auto and its fast model", async () => {
  const server = await launchVerificationServer();
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${server.info.url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const answer = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(answer)}`).toBe(status);
    return answer;
  };
  try {
    const bot = (await api("POST", "/api/bots", { name: "Model switches fixture" }, 201)).bot;
    const instanceId = bot.modelSelection.instanceId as string;
    const fast = "claude-haiku-4-5";
    const top = "claude-fable-5-1";
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: {
      instanceId, model: top, auto: true, fast: { instanceId, model: fast },
    } });
    const { task: pinned } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Own Auto fast model" }, 201);
    await api("PATCH", `/api/bots/${bot.id}/tasks/${pinned.threadId}`, { modelSelection: {
      instanceId, model: "claude-sonnet-5-5", auto: true, fast: { instanceId, model: fast },
    } });
    await api("PUT", "/api/me/models", { disabledModels: [`${instanceId}/${fast}`] });
    const cleaned = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    expect(cleaned.modelSelection.fast).toBeUndefined();
    expect(cleaned.tasks.find((entry: any) => entry.threadId === pinned.threadId).modelSelection.fast).toBeUndefined();
    // A stale or forged UI cannot save a fast model now switched off.
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: {
      instanceId, model: top, auto: true, fast: { instanceId, model: fast },
    } }, 403);

    expect((await api("GET", "/api/me/models")).mine).toEqual([`${instanceId}/${fast}`]);
    // Direct selection cannot revive a disabled model.
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId, model: fast } }, 403);
    await api("POST", `/api/bots/${bot.id}/messages`, { threadId: bot.threadId, text: "hello" }, 202);
    await expect.poll(async () => {
      const { messages } = await api("GET", `/api/threads/${bot.threadId}/messages`);
      return messages.some((entry: any) => entry.role === "bot" && entry.turnTerminal);
    }, { timeout: 30_000 }).toBe(true);
    const afterTurn = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id);
    const pick = afterTurn.tasks.find((task: any) => task.threadId === bot.threadId)?.autoModel;
    expect(pick).toBeTruthy();
    expect(pick.model).not.toBe(fast);
    // Turning off the selected base also moves it to another model on Auto.
    await api("PUT", "/api/me/models", { disabledModels: [`${instanceId}/${fast}`, `${instanceId}/${top}`] });
    const bots = (await api("GET", "/api/bots")).bots;
    const changed = bots.find((entry: any) => entry.id === bot.id);
    expect(changed.modelSelection.auto).toBe(true);
    expect(changed.modelSelection.model).not.toBe(top);
    const preview = await api("GET", `/api/bots/${bot.id}/auto-model`);
    expect(preview.pick.model).not.toBe(top);
    expect(preview.pick.model).not.toBe(fast);
    expect(preview.chain.length).toBeGreaterThan(0);
    expect(preview.chain.every((entry: any) => entry.model !== top && entry.model !== fast)).toBe(true);
    expect(preview.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId, model: top, reason: "modelOff" }),
      expect.objectContaining({ instanceId, model: fast, reason: "modelOff" }),
    ]));
    // The same dispatch diagnostics are available for a pinned bot's backup card.
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId, model: preview.pick.model } });
    const pinnedPreview = await api("GET", `/api/bots/${bot.id}/auto-model`);
    expect(pinnedPreview.auto).toBe(false);
    expect(pinnedPreview.chain).toEqual(preview.chain);
    expect(pinnedPreview.backups).toEqual([]);
    // With this engine's whole catalog off, the bot still changes to Auto.
    const instance = (await api("GET", "/api/instances")).instances.find((entry: any) => entry.instanceId === instanceId);
    const disabledModels = instance.models.options.map((entry: any) => `${instanceId}/${entry.id}`);
    await api("PUT", "/api/me/models", { disabledModels });
    expect((await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id).modelSelection.auto).toBe(true);
    const exhausted = await api("GET", `/api/bots/${bot.id}/auto-model`);
    expect(exhausted.pick).toBeNull();
    expect(exhausted.chain).toEqual([]);
  } finally {
    await server.close();
  }
}, 90_000);


it("shows configured custom endpoint backups even outside the Auto candidate list", async () => {
  const upstream = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "vendor/backup" }] }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const endpointUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
  const server = await launchVerificationServer();
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${server.info.url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result;
  };
  try {
    await api("PUT", "/api/me/providers/servers/lab", { instanceId: "lab", name: "Local backup", url: endpointUrl,
      protocol: "openai", models: [{ id: "vendor/backup", label: "Custom backup model" }] });
    const instances = (await api("GET", "/api/instances")).instances;
    const endpoint = instances.find((entry: any) => entry.providerAccount?.serverId === "lab");
    expect(endpoint).toBeTruthy();
    const { bot } = await api("POST", "/api/bots", { name: "Custom backup fixture" });
    const backup = { instanceId: endpoint.instanceId, model: "vendor/backup" };
    await api("PATCH", `/api/bots/${bot.id}/runtime-settings`, { automaticRecovery: { enabled: true, backup } });
    const preview = await api("GET", `/api/bots/${bot.id}/auto-model`);
    expect(preview.backups).toEqual([{ ...backup, engineLabel: "Local backup", modelLabel: "Custom backup model" }]);
    expect(preview.chain.some((entry: any) => entry.instanceId === backup.instanceId && entry.model === backup.model)).toBe(false);
  } finally {
    await server.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}, 60_000);
