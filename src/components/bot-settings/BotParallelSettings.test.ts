import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, ConfigStatus } from "@/state/store";
import { BotParallelSettings } from "./BotParallelSettings";

const fixture = vi.hoisted(() => ({
  values: [] as unknown[], index: 0,
  config: {} as Pick<ConfigStatus, "threads">,
  bot: { id: "b1", name: "Bot" } as Bot,
  api: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = initial;
    return [fixture.values[index], (next: unknown) => { fixture.values[index] = next; }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    return fixture.values[index] ??= { current: initial };
  },
}));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { config: fixture.config }, dispatch: vi.fn() }),
}));

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(value: ReactNode): Node[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as Node;
    return [node, ...nodes(node.props.children)];
  });
}
function render() {
  let tree: ReactNode = null;
  function Capture() { fixture.index = 0; tree = BotParallelSettings({ bot: fixture.bot }); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  const all = nodes(tree);
  // Each limit is a pill menu (PillSelect), found by its spoken name.
  const byLabel = (label: string) => all.find((node) => node.props.ariaLabel === label)!;
  return {
    html,
    threads: byLabel("Maximum running conversations for this bot"),
    perPerson: byLabel("Parallel tasks per person on this bot"),
  };
}
const choose = (node: Node, value: string) => (node.props.onChange as (next: string) => void)(value);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeEach(() => {
  fixture.values = [];
  fixture.config = { threads: { maxConcurrentPerBot: 4, maxParallelPerPerson: 2 } };
  fixture.bot = { id: "b1", name: "Bot" } as Bot;
  fixture.api.mockReset();
});

describe("BotParallelSettings (per bot, 2026-10-15)", () => {
  it("shows the server default until the bot has its own, and no busy-send choice (the bot routes)", () => {
    const view = render();
    expect(view.html).toContain("Parallel conversations");
    expect(view.html).toContain("Maximum running conversations for this bot");
    expect(view.threads.props.value).toBe("4");
    expect(view.perPerson.props.value).toBe("2");
    expect(view.html).not.toContain("When someone writes while this bot is working");
  });

  it("shows the bot's own values", () => {
    fixture.bot = { ...fixture.bot, maxConcurrentThreads: 1, maxParallelPerPerson: 5, busySend: "after" };
    const view = render();
    expect(view.threads.props.value).toBe("1");
    expect(view.perPerson.props.value).toBe("5");
  });

  it("saves each change on this bot, never in Settings", async () => {
    fixture.api.mockResolvedValue({ stored: { maxConcurrentThreads: 6 } });
    choose(render().threads, "6");
    await flush();
    expect(fixture.api).toHaveBeenCalledWith("/api/bots/b1/runtime-settings", { method: "PATCH", body: JSON.stringify({ maxConcurrentThreads: 6 }) });
    expect(render().threads.props.value).toBe("6");
    fixture.api.mockResolvedValue({ stored: { maxParallelPerPerson: 9 } });
    choose(render().perPerson, "9");
    await flush();
    expect(fixture.api).toHaveBeenLastCalledWith("/api/bots/b1/runtime-settings", { method: "PATCH", body: JSON.stringify({ maxParallelPerPerson: 9 }) });
    expect(fixture.api.mock.calls.every(([path]) => path !== "/api/config")).toBe(true);
  });

  it("says why a save failed", async () => {
    fixture.api.mockRejectedValue(new Error("forbidden: only the bot's owner or an admin can change its settings"));
    choose(render().threads, "2");
    await flush();
    expect(render().html).toContain("only the bot&#x27;s owner or an admin");
  });
});
