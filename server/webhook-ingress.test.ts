import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  advertisedWebhookBase,
  AuthFailureLimiter,
  WEBHOOK_AUTH_FAILURE_LIMIT,
  listenWebhookIngress,
  MAX_WEBHOOK_BODY_BYTES,
  webhookCredential,
  type WebhookIngress,
} from "./webhook-ingress.ts";
import { WebhookManager } from "./webhooks.ts";
import { WorkspaceBackupMaintenance } from "./workspace-backup-maintenance.ts";

let dir: string;
let ingress: WebhookIngress;
let endpointId: string;
let secret: string;
let manager: WebhookManager;
const queued: Array<Record<string, unknown>> = [];
const bearer = (token = secret): Record<string, string> => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "omb-webhook-ingress-"));
  manager = new WebhookManager({
    file: join(dir, "webhooks.json"),
    botState: () => "ready",
    enqueue: (input) => {
      queued.push(input);
      return { id: `run-${queued.length}` };
    },
  });
  const created = manager.create({ name: "Build event", prompt: "Review the build", botId: "maus-1" });
  endpointId = created.webhook.endpointId;
  secret = created.secret;
  // generous: the refusal tests below make many failed calls from one address
  ingress = await listenWebhookIngress(manager, { port: 0, limiter: new AuthFailureLimiter(1_000) });
});

afterAll(async () => {
  await new Promise<void>((resolve) => ingress.server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe("webhook-only ingress", () => {
  it("does not record or enqueue incoming webhooks during workspace backup", async () => {
    const gate = new WorkspaceBackupMaintenance();
    const guarded = await listenWebhookIngress(manager, { port: 0, claimRequest: () => gate.request() });
    const before = manager.listAttempts();
    const beforeQueued = queued.length;
    try {
      await gate.run(async () => {
        const response = await fetch(`${guarded.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: bearer(), body: "{}" });
        expect(response.status).toBe(503);
        expect(manager.listAttempts()).toEqual(before);
        expect(queued).toHaveLength(beforeQueued);
      }, { idle: () => true, pause: () => {}, resume: () => {}, flush: async () => {} });
    } finally {
      await new Promise<void>((resolve) => guarded.server.close(() => resolve()));
    }
  });
  it("exposes health but nothing from the main Sagax API", async () => {
    const health = await fetch(`${ingress.baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ app: "openmausbot-webhooks", ready: true });
    expect((await fetch(`${ingress.baseUrl}/api/bots`)).status).toBe(404);
  });

  it("accepts the bearer token and deduplicates retries", async () => {
    const credential = webhookCredential(ingress.baseUrl, endpointId, secret);
    const send = () => fetch(credential.endpointUrl, {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json", "idempotency-key": "delivery-1", "x-github-event": "push" },
      body: JSON.stringify({ ref: "main", id: "event-in-body" }),
    });
    const first = await send();
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ accepted: true, duplicate: false, runId: "run-1" });
    const retry = await send();
    expect(retry.status).toBe(202);
    expect(await retry.json()).toMatchObject({ accepted: true, duplicate: true, runId: "run-1" });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.prompt).toContain("Event: push");
  });

  it("accepts the bearer scheme in any letter case", async () => {
    const response = await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { authorization: `bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
      body: "ticket=42&priority=high",
    });
    expect(response.status).toBe(202);
    expect(queued.at(-1)?.prompt).toContain('"ticket": "42"');
  });

  it("does not deduplicate separate requests that reuse a generic payload id", async () => {
    const credential = webhookCredential(ingress.baseUrl, endpointId, secret);
    const before = queued.length;
    const send = () => fetch(credential.endpointUrl, {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json" },
      body: JSON.stringify({ id: "shared-record", task: "Handle this update" }),
    });
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(202);
    expect(queued).toHaveLength(before + 2);
  });

  it("captures a verification event without queueing work", async () => {
    const created = manager.create({ name: "Verify", prompt: "", botId: "maus-1", enabled: false, verificationPending: true });
    const before = queued.length;
    const response = await fetch(webhookCredential(ingress.baseUrl, created.webhook.endpointId, created.secret).endpointUrl, {
      method: "POST",
      headers: { ...bearer(created.secret), "content-type": "application/json", "x-webhook-event": "support.created" },
      body: JSON.stringify({ task: "Triage ticket 42" }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true, captured: true });
    expect(queued).toHaveLength(before);
    expect(manager.list().find((webhook) => webhook.id === created.webhook.id)).toMatchObject({ verificationPending: false, enabled: false });
  });

  it("rejects malformed JSON and oversized bodies from an authenticated sender", async () => {
    const malformed = await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);

    const oversized = await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { ...bearer(), "content-type": "text/plain" },
      body: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1),
    });
    expect(oversized.status).toBe(413);
  });
});

describe("bearer token is the only credential", () => {
  const expectRefused = async (response: Response) => {
    expect(response.status).toBe(401);
    // no detail about which part was wrong
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  };

  it("refuses a call with no Authorization header", async () => {
    const before = queued.length;
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", body: "{}" }));
    expect(queued).toHaveLength(before);
  });

  it("refuses a wrong token and another scheme", async () => {
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: bearer("whsec_wrong"), body: "{}" }));
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: { authorization: `Basic ${secret}` }, body: "{}" }));
  });

  it("refuses a token in the query string", async () => {
    const before = queued.length;
    for (const name of ["token", "secret", "access_token", "bearer"]) {
      await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}?${name}=${encodeURIComponent(secret)}`, { method: "POST", body: "{}" }));
    }
    expect(queued).toHaveLength(before);
  });

  it("refuses a token in the body", async () => {
    const before = queued.length;
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: secret, secret, authorization: `Bearer ${secret}` }),
    }));
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(secret)}`,
    }));
    expect(queued).toHaveLength(before);
  });

  it("refuses the old capability URL and the old secret header, even with the right secret", async () => {
    const before = queued.length;
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}/${encodeURIComponent(secret)}`, { method: "POST", body: "{}" }));
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: { "x-openmaus-secret": secret }, body: "{}" }));
    expect(queued).toHaveLength(before);
  });

  it("records a refused call without storing the token it carried", async () => {
    await fetch(`${ingress.baseUrl}/hooks/${endpointId}?token=${encodeURIComponent(secret)}`, { method: "POST", body: "{}" });
    const rejected = manager.listAttempts().filter((attempt) => attempt.outcome === "rejected" && attempt.statusCode === 401);
    expect(rejected.length).toBeGreaterThan(0);
    expect(JSON.stringify(rejected)).not.toContain(secret);
  });

  it("treats an unknown endpoint exactly like a wrong token", async () => {
    await expectRefused(await fetch(`${ingress.baseUrl}/hooks/wh_unknown`, { method: "POST", headers: bearer(), body: "{}" }));
  });
});

describe("failed authentication rate limit", () => {
  it("answers 429 after repeated failures from one source, then recovers", async () => {
    let clock = 1_000_000;
    const limiter = new AuthFailureLimiter(WEBHOOK_AUTH_FAILURE_LIMIT, 60_000, () => clock);
    const limited = await listenWebhookIngress(manager, { port: 0, limiter });
    try {
      const call = (headers: Record<string, string>) => fetch(`${limited.baseUrl}/hooks/${endpointId}`, { method: "POST", headers, body: "{}" });
      for (let i = 0; i < WEBHOOK_AUTH_FAILURE_LIMIT; i += 1) expect((await call(bearer("whsec_wrong"))).status).toBe(401);
      const blocked = await call(bearer("whsec_wrong"));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("60");
      // a good token from the same source is held back too, so a guess cannot be confirmed
      expect((await call(bearer())).status).toBe(429);
      clock += 61_000;
      expect((await call(bearer())).status).toBe(202);
    } finally {
      await new Promise<void>((resolve) => limited.server.close(() => resolve()));
    }
  });

  it("does not count successful calls", async () => {
    const limiter = new AuthFailureLimiter(3, 60_000, () => 0);
    const limited = await listenWebhookIngress(manager, { port: 0, limiter });
    try {
      for (let i = 0; i < 5; i += 1) {
        const ok = await fetch(`${limited.baseUrl}/hooks/${endpointId}`, { method: "POST", headers: bearer(), body: "{}" });
        expect(ok.status).toBe(202);
      }
    } finally {
      await new Promise<void>((resolve) => limited.server.close(() => resolve()));
    }
  });
});

describe("advertised base URL", () => {
  it("hands senders the public base instead of the loopback listener", async () => {
    const proxied = await listenWebhookIngress(manager, { port: 0, publicBaseUrl: "https://bots.example.com/" });
    try {
      expect(proxied.baseUrl).toBe("https://bots.example.com");
      expect(proxied.host).toBe("127.0.0.1");
      const credential = webhookCredential(proxied.baseUrl, endpointId, secret);
      expect(credential.endpointUrl).toBe(`https://bots.example.com/hooks/${endpointId}`);
      expect(credential.command).toBe(`curl -X POST https://bots.example.com/hooks/${endpointId} -H "Authorization: Bearer ${secret}"`);
      // the listener itself is still local: the public base only changes what is advertised
      const health = await fetch(`http://127.0.0.1:${proxied.port}/health`);
      expect(health.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => proxied.server.close(() => resolve()));
    }
  });

  it("refuses a base that is not an absolute http(s) URL, naming the fix", () => {
    for (const bad of ["bots.example.com", "ftp://bots.example.com", "", "/hooks"]) {
      expect(() => advertisedWebhookBase(bad)).toThrow(/absolute http\(s\) URL such as https:\/\//);
    }
    expect(advertisedWebhookBase("http://10.0.0.5:8800///")).toBe("http://10.0.0.5:8800");
  });
});
