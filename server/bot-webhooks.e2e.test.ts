// The persona window's Access > Webhooks flow against the real server: a
// webhook created for one bot hands its token over once, the list keeps the
// last 4 characters only, and pause, regenerate and delete work by id
// (src/components/bot-settings/BotWebhooks.tsx drives these same routes).
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("creates a bot's webhook, shows its token once, pauses, regenerates and deletes it", async () => {
  const fixture = await launchVerificationServer();
  const { url } = fixture.info;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: await response.json().catch(() => null) as any };
  };
  try {
    const bot = (await call("POST", "/api/bots", { name: "Webhook persona probe" })).body.bot;
    const created = await call("POST", "/api/webhooks", { name: "Build failed", prompt: "", botId: bot.id, runOn: "maus", eventTypes: [], maxPendingRuns: null });
    expect(created.status).toBe(201);
    expect(created.body.webhook.botId).toBe(bot.id);
    expect(created.body.credential.token).toMatch(/^whsec_/);
    expect(created.body.credential.command).toContain(`Authorization: Bearer ${created.body.credential.token}`);
    const id = created.body.webhook.id;

    const listed = await call("GET", "/api/webhooks");
    const row = listed.body.webhooks.find((webhook: { id: string }) => webhook.id === id);
    expect(row.tokenLast4).toBe(created.body.credential.token.slice(-4));
    expect(JSON.stringify(listed.body)).not.toContain(created.body.credential.token);

    const paused = await call("PATCH", `/api/webhooks/${id}`, { enabled: false, verificationPending: false });
    expect(paused.body.webhook.enabled).toBe(false);

    const rotated = await call("POST", `/api/webhooks/${id}/rotate`);
    expect(rotated.body.credential.token).toMatch(/^whsec_/);
    expect(rotated.body.credential.token).not.toBe(created.body.credential.token);

    expect((await call("DELETE", `/api/webhooks/${id}`)).status).toBe(200);
    expect((await call("GET", "/api/webhooks")).body.webhooks.some((webhook: { id: string }) => webhook.id === id)).toBe(false);
  } finally {
    await fixture.close();
  }
}, 45_000);
