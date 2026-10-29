// A webhook routine's webhook, managed where the routine is (2026-10-29).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine } from "@/lib/routines";
import type { WebhookTrigger } from "@/lib/webhooks";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ webhooks: [] as unknown[], config: null as unknown }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({ state: { webhooks: fixture.webhooks, webhookIngress: { available: true, baseUrl: "https://hooks.example.test/" }, config: fixture.config }, dispatch: vi.fn() }),
}));
import { RoutineWebhookPanel, routineWebhookCurl, routineWebhookFor, routineWebhookUrl } from "./RoutineWebhookPanel";

const bot = { id: "scout", name: "Scout", ownerUserId: "owner@example.test" } as unknown as Bot;
const routine = { id: "r1", name: "New order", botId: "scout", schedule: { type: "webhook" } } as unknown as Routine;
const hook = { id: "w1", endpointId: "wh_abc", routineId: "r1", name: "New order", prompt: "", botId: "scout", runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 12, tokenLast4: "x8Qa" } as WebhookTrigger;
const render = (props: { routine?: Routine; bot?: Bot }) => renderToStaticMarkup(createElement(RoutineWebhookPanel, props));

beforeEach(() => {
  setLocale("en");
  fixture.config = null;
  fixture.webhooks = [hook, { ...hook, id: "w2", routineId: "r2" }];
});

describe("RoutineWebhookPanel", () => {
  it("finds the routine's own webhook and builds its address and curl example", () => {
    expect(routineWebhookFor(fixture.webhooks as WebhookTrigger[], "r1")?.id).toBe("w1");
    expect(routineWebhookFor(fixture.webhooks as WebhookTrigger[], undefined)).toBeUndefined();
    expect(routineWebhookUrl("https://hooks.example.test/", hook)).toBe("https://hooks.example.test/hooks/wh_abc");
    expect(routineWebhookCurl("https://h/hooks/x", undefined)).toContain('Authorization: Bearer <key>');
    expect(routineWebhookCurl("https://h/hooks/x", "whsec_full")).toContain("Bearer whsec_full");
  });

  it("shows the address, the masked key and header, Show, Copy, curl and Regenerate to the owner", () => {
    const html = render({ routine, bot });
    expect(html).toContain('data-routine-webhook="w1"');
    expect(html).toContain("POST to");
    expect(html).toContain("https://hooks.example.test/hooks/wh_abc");
    expect(html).toContain("whsec_••••x8Qa");
    expect(html).toContain("Authorization: Bearer whsec_••••x8Qa");
    expect(html).toContain("data-show-key");
    expect(html).toContain("Copy a curl example");
    expect(html).toContain("Regenerate the key");
    expect(html).toContain("12 deliveries");
  });

  it("lets someone else read the address but not see or change the key", () => {
    fixture.config = { viewer: { role: "member", principalId: "someone@example.test" } };
    const html = render({ routine, bot });
    expect(html).toContain("https://hooks.example.test/hooks/wh_abc");
    expect(html).not.toContain("data-show-key");
    expect(html).not.toContain("Regenerate the key");
  });

  it("says a new routine gets its address on save, and offers a webhook to an older routine without one", () => {
    expect(render({ bot })).toContain("appear once the routine is saved");
    fixture.webhooks = [];
    const html = render({ routine, bot });
    expect(html).toContain('data-routine-webhook="missing"');
    expect(html).toContain("Create its webhook");
  });
});
