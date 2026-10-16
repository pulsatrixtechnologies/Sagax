import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebhookTrigger } from "@/lib/webhooks";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { webhookAttempts: [], routineRuns: [] }, dispatch: fixture.dispatch }),
}));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => createElement("span") }));
import { TypedTriggerRow, automationText, draftFromConfig, pollerCredentialsInput, sourceEndpointUrl, typedSourceConfig, typedTriggerInput } from "./TypedTriggers";

type Props = { children?: ReactNode; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as ReactElement<Props>;
    return [node, ...nodes(node.props.children)];
  });
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const trigger = (extra: Partial<WebhookTrigger> = {}): WebhookTrigger => ({
  id: "w1", endpointId: "wh_abc", name: "PRs", prompt: "", botId: "b1", runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 0,
  source: { type: "github", events: ["pr.opened"], filters: { repo: ["acme/*"] } }, signingSecretSet: true, ...extra,
});

function renderRow(webhook: WebhookTrigger, onSetup = vi.fn()) {
  let tree!: ReactElement;
  function Capture() {
    tree = TypedTriggerRow({
      webhook, bot: undefined, setup: undefined, baseUrl: "https://hooks.example/", busy: false,
      onToggle: vi.fn(), onDelete: vi.fn(), onEdit: vi.fn(), onSetup, onOpenChat: vi.fn(),
    });
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  const all = nodes(tree);
  const button = (text: string) => all.find((node) => node.type === "button" && renderToStaticMarkup(node as ReactElement).includes(text))!;
  return { html, all, button };
}

beforeEach(() => {
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  vi.stubGlobal("window", { confirm: () => true });
});
afterEach(() => vi.unstubAllGlobals());

describe("typed trigger helpers", () => {
  it("parses comma-separated filters, drops unknown events, bounds the rate and keeps the tenant for Graph only", () => {
    const draft = { events: ["ci.failed", "mention"], filters: { repo: " a/b , a/* ,a/b", channel: "C1" }, signingSecret: "", tenantId: " t-1 ", rateLimit: "0" };
    expect(typedSourceConfig("github", draft)).toEqual({ type: "github", events: ["ci.failed"], filters: { repo: ["a/b", "a/*"] } });
    expect(typedSourceConfig("teams", { ...draft, events: [], rateLimit: "120" })).toEqual({ type: "teams", events: [], filters: { channel: ["C1"] }, rateLimitPerMinute: 120, tenantId: "t-1" });
    expect(typedSourceConfig("teams", { ...draft, events: [], rateLimit: "121" }).rateLimitPerMinute).toBeUndefined();
  });
  it("round-trips a stored config into an editable draft without any secret", () => {
    expect(draftFromConfig({ type: "github", events: ["pr.opened"], filters: { repo: ["a/b", "c/*"] }, rateLimitPerMinute: 5 })).toEqual({
      events: ["pr.opened"], filters: { repo: "a/b, c/*" }, signingSecret: "", tenantId: "", rateLimit: "5",
    });
  });
  it("builds a Graph connector or a poller from the draft, never both, and keeps the ICS link out of the source", () => {
    const base = { events: [], filters: {}, signingSecret: "", tenantId: "", rateLimit: "" };
    expect(typedSourceConfig("email", { ...base, connection: "graph", graphConnector: "ms365|default", graphResource: "" })).toEqual({ type: "email", events: [], filters: {}, graph: { connector: "ms365" } });
    expect(typedSourceConfig("teams", { ...base, connection: "graph", graphConnector: "ms365|acct-abcdef12", graphResource: " teams/1/channels/2/messages " }).graph)
      .toEqual({ connector: "ms365", account: "acct-abcdef12", resource: "teams/1/channels/2/messages" });
    expect(typedSourceConfig("email", { ...base, connection: "poller", pollerHost: " imap.example.com ", pollerPort: "993", pollerUsername: "me", pollerSecret: "pw", pollerInterval: "99" }).poller)
      .toEqual({ kind: "imap", host: "imap.example.com", port: 993, username: "me" });
    const ics = { ...base, connection: "poller" as const, pollerKind: "ics" as const, pollerSecret: " https://cal.example.com/private.ics ", pollerLead: "0" };
    expect(typedSourceConfig("calendar", ics).poller).toEqual({ kind: "ics", leadMinutes: 0 });
    expect(pollerCredentialsInput("calendar", ics)).toEqual({ url: "https://cal.example.com/private.ics" });
    expect(typedTriggerInput("calendar", ics, { name: "Cal", prompt: "", botId: "b1" })).toMatchObject({ pollerCredentials: { url: "https://cal.example.com/private.ics" } });
    expect(JSON.stringify(typedSourceConfig("calendar", ics))).not.toContain("private.ics");
    expect(typedSourceConfig("github", { ...base, connection: "poller" }).poller).toBeUndefined();
    expect(pollerCredentialsInput("email", { ...base, connection: "manual", pollerSecret: "pw" })).toBeUndefined();
  });

  it("names the automation state by code, with a generic line for an unknown one", () => {
    expect(automationText({ kind: "poller", state: "error", code: "sign-in-refused", at: 1 })).toEqual({ text: "The server refused the sign-in", tone: "error" });
    expect(automationText({ kind: "graph", state: "error", code: "made-up", at: 1 })).toEqual({ text: "Connection problem", tone: "error" });
    expect(automationText(undefined)).toBeNull();
  });

  it("builds the source URL from the advertised base", () => {
    expect(sourceEndpointUrl("https://hooks.example/", { endpointId: "wh_x" })).toBe("https://hooks.example/sources/wh_x");
  });
});

describe("TypedTriggerRow", () => {
  it("test-fires through the existing test route", async () => {
    fixture.api.mockResolvedValue({ runId: "run-1", deliveryId: "test-1", duplicate: false });
    const { button } = renderRow(trigger());
    (button("Send a test event").props.onClick as () => void)();
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/w1/test", { method: "POST", body: "{}" });
  });

  it("saves events and filters as a PATCH of the source only", async () => {
    fixture.api.mockResolvedValue({ webhook: trigger() });
    const { button } = renderRow(trigger());
    (button("Save events and filters").props.onClick as () => void)();
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/w1", { method: "PATCH", body: JSON.stringify({ source: { type: "github", events: ["pr.opened"], filters: { repo: ["acme/*"] } } }) });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "webhookPatched", webhook: trigger() });
  });

  it("asks before making a new generated secret and hands the new setup up once", async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    vi.stubGlobal("window", { confirm });
    const onSetup = vi.fn();
    fixture.api.mockResolvedValue({ webhook: trigger(), sourceSetup: { endpointUrl: "https://hooks.example/sources/wh_abc", secret: "whsec_new" } });
    const { button } = renderRow(trigger(), onSetup);
    (button("New signing secret").props.onClick as () => void)();
    await flush();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(String(confirm.mock.calls[0])).toContain("stops working immediately");
    (button("New signing secret").props.onClick as () => void)();
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/webhooks/w1/rotate", { method: "POST" });
    expect(onSetup).toHaveBeenCalledWith({ endpointUrl: "https://hooks.example/sources/wh_abc", secret: "whsec_new" });
  });

  it("shows a poller's state and an empty write-only password field, never a stored value", () => {
    const webhook = trigger({ source: { type: "email", events: [], filters: {}, poller: { kind: "imap", host: "imap.example.com", username: "me" } }, pollerCredentialsSet: false,
      automation: { kind: "poller", state: "error", code: "no-credentials", at: 1 } });
    const { html } = renderRow(webhook);
    expect(html).toContain("No password or link yet");
    expect(html).toContain("Add the user name and password (or the link)");
    expect(html).not.toContain("No signing secret yet");
    const tag = html.match(/<input[^>]*data-typed-poller-secret[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('type="password"');
    expect(tag).toContain('value=""');
    expect(html).toContain("Sagax reads this source itself");
  });

  it("offers a write-only secret field for a provided secret, never a rotation", () => {
    const { html, all } = renderRow(trigger({ source: { type: "pagerduty", events: [], filters: {} }, signingSecretSet: false }));
    expect(html).toContain("No signing secret yet");
    expect(html).not.toContain("New signing secret");
    const field = all.find((node) => node.type === "input" && node.props.type === "password" && String(node.props["aria-label"]).includes("PagerDuty"));
    expect(field?.props.value).toBe("");
    expect(html).toContain("Generic Webhooks (v3)");
  });
});
