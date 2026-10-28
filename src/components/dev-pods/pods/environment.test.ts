// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.fn(async (_path: string): Promise<{ items?: unknown }> => ({ items: [] }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: (path: string) => api(path),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => null,
}));

const { environmentWork } = await import("./environment");
await import("./environment");

const bot = { id: "dev", threadId: "thread-1", name: "Dev", cwd: "/Users/me/acme/portal" } as unknown as Bot;
const ctx = { bot, task: undefined, messages: [] as Message[], threadKey: "dev:thread-1", computerStart: undefined, dispatch: () => undefined };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  api.mockReset();
  api.mockResolvedValue({ items: [] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

function render(data: { folder: string | null; branch: string | null }, extra: Partial<typeof ctx> = {}) {
  return act(async () => {
    const { devPodDefinitions } = await import("../registry");
    const pod = devPodDefinitions().find((entry) => entry.id === "environment")!;
    root.render(createElement(pod.Body, {
      data: { place: "local", placeLabel: "This computer", computer: true, state: null, ...data },
      ctx: { ...ctx, ...extra },
    }));
  });
}

describe("environment work", () => {
  it("reads the repository and the branch of this conversation only", () => {
    const payload = {
      items: [
        { threadId: "other", code: { repo: "acme/other", branch: "wip" } },
        { threadId: "thread-1", code: { repo: "acme/portal", repoUrl: "https://example.com/acme/portal", branch: "fix/sso" } },
      ],
    };
    expect(environmentWork(payload, "thread-1")).toEqual({ repo: { name: "acme/portal", url: "https://example.com/acme/portal" }, branch: "fix/sso" });
  });

  it("says nothing when the server has no repository", () => {
    expect(environmentWork({ items: [{ threadId: "thread-1" }] }, "thread-1")).toEqual({});
    expect(environmentWork(null, "thread-1")).toEqual({});
    expect(environmentWork({ items: "nope" }, "thread-1")).toEqual({});
  });
});

describe("environment folder menu", () => {
  it("offers the folder actions and shows the repository the server named", async () => {
    api.mockImplementation(async () => ({ items: [{ threadId: "thread-1", code: { repo: "acme/portal", branch: "fix/sso" } }] }));
    await render({ folder: "/Users/me/acme/portal", branch: null });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector("[data-env-repo]")!.textContent).toContain("acme/portal");
    expect(container.querySelector("[data-env-branch]")!.textContent).toContain("fix/sso");
    const menu = container.querySelector<HTMLButtonElement>("[data-env-folder] [data-env-menu]")!;
    await act(async () => { menu.click(); });
    const items = [...document.body.querySelectorAll("[role='menuitem']")].map((node) => node.textContent);
    expect(items).toEqual([
      t("devPods.environment.showInFinder"),
      t("devPods.environment.copyPath"),
      t("devPods.environment.changeFolder"),
      t("devPods.environment.addFolder"),
      t("devPods.environment.openTerminal"),
    ]);
  });

  it("keeps the folder actions that need this computer off a remote folder", async () => {
    await render({ folder: "remote:work", branch: "main" });
    const menu = container.querySelector<HTMLButtonElement>("[data-env-folder] [data-env-menu]")!;
    await act(async () => { menu.click(); });
    const items = [...document.body.querySelectorAll("[role='menuitem']")].map((node) => node.textContent);
    expect(items).toEqual([t("devPods.environment.copyPath"), t("devPods.environment.addFolder")]);
  });

  it("says where the bot works on one line, and saves a new place from its menu", async () => {
    const dispatch = vi.fn();
    await render({ folder: "/Users/me/acme/portal", branch: null }, { dispatch });
    expect(container.querySelectorAll("[data-env-place]")).toHaveLength(1);
    expect(container.querySelector("[data-env-place-label]")!.textContent).toBe("This computer");
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-env-menu="place"]')!.click(); });
    const cloud = document.body.querySelector<HTMLButtonElement>('[data-env-place-choice="cloud"]')!;
    await act(async () => { cloud.click(); });
    expect(dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "dev", patch: { computer: "cloud" } });
  });

  it("never shows a Remote Control row, even with a link or a socket in the conversation", async () => {
    await render({ folder: null, branch: null }, {
      messages: [
        { id: "m1", role: "bot", kind: "text", text: "PR: https://example.com/acme/portal/pull/3" },
        { id: "m2", role: "bot", kind: "text", text: "socket tc" + "a".repeat(30) },
      ] as never,
    });
    expect(container.querySelector("[data-env-remote]")).toBeNull();
    expect(container.textContent).not.toContain("Remote");
  });
});
