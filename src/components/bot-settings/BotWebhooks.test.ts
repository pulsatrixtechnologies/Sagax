// Persona > Access > Webhooks: create, open, pause, rotate and delete a
// bot's webhooks where the bot is, owner only, with the token shown once.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, ConfigStatus } from "@/state/store";
import type { WebhookTrigger } from "@/lib/webhooks";
import { setLocale } from "@/lib/i18n";

// useState seeded by call order (effects never run under server rendering):
// useWebhookActions owns 0 to 4, BotWebhooks' editor is 5.
const fixture = vi.hoisted(() => ({
  webhooks: [] as unknown[],
  config: null as unknown,
  overrides: new Map<number, unknown>(),
  index: 0,
  counting: false,
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => {
      if (!fixture.counting) return react.useState(initial);
      const index = fixture.index++;
      const seeded = fixture.overrides.has(index) ? fixture.overrides.get(index) : typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [seeded, () => {}];
    },
  };
});
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({
    state: { bots: [], webhooks: fixture.webhooks, webhookAttempts: [], routineRuns: [], webhookIngress: { available: true }, instances: [], config: fixture.config },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/components/Avatar", () => ({ BotAvatar: ({ bot }: { bot: Bot }) => createElement("span", { "data-avatar": bot.id }) }));
vi.mock("../markdown/MarkdownEditor", () => ({ MarkdownEditor: () => createElement("textarea") }));
import { BotWebhooks, canManageBotWebhooks } from "./BotWebhooks";

const bot = { id: "scout", name: "Scout", ownerUserId: "owner@example.test", modelSelection: { instanceId: "claude", model: "m" } } as unknown as Bot;
const webhook = (id: string, extra: Partial<WebhookTrigger> = {}): WebhookTrigger => ({
  id, endpointId: `ep-${id}`, name: "GitHub", prompt: "", botId: "scout", runOn: "maus", enabled: true,
  createdAt: 1, updatedAt: 1, deliveryCount: 4, tokenLast4: "k3Yz", ...extra,
});
const member = (principalId: string) => ({ viewer: { role: "member", principalId } }) as unknown as ConfigStatus;

function render(overrides: Record<number, unknown> = {}) {
  fixture.overrides = new Map(Object.entries(overrides).map(([key, value]) => [Number(key), value]));
  fixture.index = 0;
  fixture.counting = true;
  try {
    return renderToStaticMarkup(createElement(BotWebhooks, { bot }));
  } finally {
    fixture.counting = false;
  }
}

beforeEach(() => {
  setLocale("en");
  fixture.config = null;
  fixture.webhooks = [webhook("w1"), webhook("other", { botId: "someone-else", name: "Not mine" })];
});
afterEach(() => vi.unstubAllGlobals());

describe("BotWebhooks", () => {
  it("lists only this bot's webhooks, with the owner's actions and a New webhook button", () => {
    const html = render();
    expect(html).toContain('data-new-webhook=""');
    expect(html).toContain('data-bot-webhook="w1"');
    expect(html).not.toContain("Not mine");
    expect(html).toContain('aria-label="Pause GitHub"');
    expect(html).toContain('aria-label="Regenerate the token of GitHub"');
    expect(html).toContain('aria-label="Delete GitHub"');
    expect(html).toContain("whsec_••••k3Yz");
    expect(html).toContain("4 deliveries");
    expect(html).not.toContain("Owner-only");
  });

  it("offers the token once for a migrated webhook instead of regenerating it", () => {
    fixture.webhooks = [webhook("w1", { tokenPending: true })];
    const html = render();
    expect(html).toContain('aria-label="Show the token of GitHub"');
    expect(html).toContain("Needs its new token");
  });

  it("shows a fresh credential once: the command, copy buttons and the warning", () => {
    const html = render({ 0: { w1: { token: "whsec_secret", command: "curl -X POST https://hook.example.test/x -H \"Authorization: Bearer whsec_secret\"", url: "https://hook.example.test/x" } } });
    expect(html).toContain('data-webhook-credential=""');
    expect(html).toContain("curl -X POST https://hook.example.test/x");
    expect(html).toContain("Copy command");
    expect(html).toContain("Copy token");
    expect(html).toContain("Shown only this once.");
    expect(html).not.toContain("whsec_••••k3Yz");
  });

  it("opens the existing editor with this bot preselected", () => {
    const html = render({ 5: "new" });
    expect(html).toContain('role="dialog"');
    expect(html).toContain("New webhook");
    expect(html).toContain('data-avatar="scout"');
    expect(html).toContain("Create webhook");
  });

  it("lets anyone else read the list but not change it", () => {
    fixture.config = member("someone@example.test");
    const html = render();
    expect(html).toContain('data-bot-webhook="w1"');
    expect(html).not.toContain("data-new-webhook");
    expect(html).not.toContain('aria-label="Delete GitHub"');
    expect(canManageBotWebhooks(member("owner@example.test"), bot)).toBe(true);
    expect(canManageBotWebhooks(member("someone@example.test"), bot)).toBe(false);
    expect(canManageBotWebhooks(null, bot)).toBe(true);
  });

  it("says its empty state in one line", () => {
    fixture.webhooks = [];
    expect(render()).toContain("No webhooks for this bot.");
  });
});
