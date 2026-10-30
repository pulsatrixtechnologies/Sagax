// @vitest-environment happy-dom
// A newer app against a 0.8.7 server (2026-10-28). The fixture answers as the
// `pulsa-v0.8.7` tag does: its descriptor has no feature list, its routines
// listing has no `folders`, a route it does not know is 404 "no route:
// METHOD /path" for an admin, and a route not yet on its member list is 403
// "forbidden: this session lacks the admin scope" for a member. No screen
// shows that text: routine folders, voice keys and the person's own settings
// say "Available after the server update." and nothing is red.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";
import { SERVER_FEATURES } from "../../shared/server-features";

const fixture = vi.hoisted(() => ({
  state: { routinesLoadState: "ready", routineFolders: {} as Record<string, string[]>, routineRuns: [] as unknown[], config: {} as Record<string, unknown> },
  dispatch: vi.fn(),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch, flushBotPatches: async () => {} }),
}));

const { api, ApiError, initialState, reducer } = await import("@/state/store");
const { RoutineFolderList } = await import("@/components/routines/RoutineFolders");
const { PersonalProviderKey } = await import("@/components/settings/PersonalProviderAccount");
const { ToolCallsRow } = await import("@/components/settings/AppearanceSettings");
const { applyServerDescriptor, loadServerFeatures, noteRoutinesListing, resetServerFeatures, serverFeature } = await import("@/lib/server-features");
const { routeMissingOnServer } = await import("@/lib/server-route");

const NEEDS_UPDATE = "Available after the server update.";

/** The 0.8.7 descriptor (server/environment.ts at the tag): no `release`, no `features`. */
const DESCRIPTOR_087 = {
  environmentId: "00000000-0000-4000-8000-000000000000",
  label: "server",
  platform: "linux",
  version: "0.1.107",
  capabilities: { remoteSessions: true, selfUpdate: "operator", emailSignIn: false, signInPreview: true },
};

/** The routes the app calls that 0.8.7 does not serve (or not to a member). */
const MISSING_087: Array<{ method: string; path: string; memberOnly?: boolean }> = [
  { method: "POST", path: "/api/routines/folders" },
  { method: "GET", path: "/api/me/voice-keys" },
  { method: "GET", path: "/api/me/providers" },
  { method: "PUT", path: "/api/me/voice-keys/elevenlabs" },
  { method: "DELETE", path: "/api/me/voice-keys/xai" },
  { method: "GET", path: "/api/me/experimental", memberOnly: true },
  { method: "PATCH", path: "/api/me/experimental", memberOnly: true },
  { method: "GET", path: "/api/bots/bot-1/outbound", memberOnly: true },
];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A 0.8.7 server as an admin or a member sees it. */
function server087(role: "admin" | "member", routines: Routine[] = []) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://server.test");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;
    if (path === "/.well-known/sagax/environment" || path === "/.well-known/openmausbot/environment") return json(200, DESCRIPTOR_087);
    if (path === "/api/routines" && method === "GET") {
      return json(200, { routines, runs: [], scope: "mine", allowed: { mine: true, team: false, all: false }, facets: { teams: [], owners: [], botChoices: [] } });
    }
    const missing = MISSING_087.find((route) => route.method === method && (route.path === path || (route.path.includes("/voice-keys/") && path.startsWith("/api/me/voice-keys/"))));
    if (missing && (role === "member" || !missing.memberOnly)) {
      return role === "member"
        ? json(403, { error: "forbidden: this session lacks the admin scope" })
        : json(404, { error: `no route: ${method} ${path}` });
    }
    if (path === "/api/config") return json(200, fixture.state.config);
    return json(404, { error: `no route: ${method} ${path}` });
  });
}

const bot = { id: "bot-1", threadId: "t1", name: "Scout", title: "", description: "", notifications: false, color: "green", unread: false, messages: [] };
const routine = (id: string, name: string): Routine => ({
  id, name, prompt: "x", target: "bot", botId: bot.id, runOn: "maus", enabled: true,
  schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 5, nextRunAt: null, createdAt: 0, updatedAt: 0,
} as Routine);

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const mount = async (element: ReturnType<typeof createElement>) => { await act(async () => { root.render(element); }); await flush(); };
/** Every text the person could read as an error: the banner and red lines. */
const shownErrors = () => [
  ...fixture.dispatch.mock.calls.filter(([action]) => action?.type === "error").map(([action]) => String(action.message)),
  ...[...document.querySelectorAll(".text-danger, [role=alert]")].map((node) => node.textContent ?? ""),
];

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetServerFeatures();
  try { localStorage.clear(); } catch { /* none */ }
  fixture.dispatch.mockReset();
  fixture.state.routineFolders = {};
  fixture.state.config = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("a 0.8.7 server", () => {
  it("names no features: each is unknown until the app learns it", async () => {
    vi.stubGlobal("fetch", server087("admin"));
    await loadServerFeatures();
    for (const feature of Object.keys(SERVER_FEATURES) as Array<keyof typeof SERVER_FEATURES>) expect(serverFeature(feature)).toBe("unknown");
    // Its routines listing has no folders: routine folders are missing there.
    noteRoutinesListing(await api("/api/routines"));
    expect(serverFeature("routineFolders")).toBe("no");
  });

  it("a current server's list settles every feature", () => {
    applyServerDescriptor({ ...DESCRIPTOR_087, release: "0.8.9", capabilities: { ...DESCRIPTOR_087.capabilities, features: ["routineFolders"] } });
    expect(serverFeature("routineFolders")).toBe("yes");
    expect(serverFeature("personalVoiceKeys")).toBe("no");
  });

  for (const role of ["admin", "member"] as const) {
    it(`never surfaces "no route" for a route of the inventory (${role})`, async () => {
      vi.stubGlobal("fetch", server087(role));
      for (const route of MISSING_087) {
        if (route.memberOnly && role === "admin") continue;
        const failure = await api(route.path, { method: route.method, ...(route.method === "GET" || route.method === "DELETE" ? {} : { body: "{}" }) }).catch((error: unknown) => error);
        expect(failure, `${route.method} ${route.path}`).toBeInstanceOf(ApiError);
        expect(routeMissingOnServer(failure), `${route.method} ${route.path}`).toBe(true);
        expect((failure as Error).message).not.toMatch(/no route/);
        if (role === "admin") expect((failure as Error).message).toBe(NEEDS_UPDATE);
      }
    });
  }

  it("the error banner never shows a raw no-route line, whatever sent it", () => {
    const next = reducer(initialState, { type: "error", message: "no route: POST /api/routines/folders" });
    expect(next.error).toBe(NEEDS_UPDATE);
    expect(reducer(initialState, { type: "error", message: "boom" }).error).toBe("boom");
  });
});

describe("Routines panel against a 0.8.7 server", () => {
  const routines = [routine("r1", "[Reports] Morning"), routine("r2", "[Reports] Weekly"), routine("r3", "Loose")];
  const render = () => createElement(RoutineFolderList, {
    bot: bot as never, routines, runs: [], grouped: true, viewerPrincipalId: null, onOpen: () => {}, onCreateIn: () => {},
  });
  const openRowMenu = () => {
    const more = host.querySelector("[data-routine-row-menu]") as HTMLButtonElement;
    act(() => more.click());
  };

  // Since #1669 a routine's menu acts on the routine (no folder items there):
  // against the old server it opens without folder actions and without red.
  it("hides Sort by prefix and opens the routine menu without folder actions", async () => {
    vi.stubGlobal("fetch", server087("admin", routines));
    noteRoutinesListing(await api("/api/routines"));
    await mount(render());
    expect(host.querySelector("[data-routine-prefix-offer]")).toBeNull();
    expect(shownErrors()).toEqual([]);
    openRowMenu();
    const menu = document.querySelector("[data-routine-folder-menu=row]");
    expect(menu).not.toBeNull();
    expect(menu?.querySelector("[data-routine-new-folder]")).toBeNull();
    expect(menu?.querySelector("[data-routine-folder-unavailable]")).toBeNull();
    await flush();
    expect(document.querySelector("[data-routine-folder-name-input]")).toBeNull();
    // The open menu's Delete item is red by design: only error dispatches count here.
    expect(fixture.dispatch.mock.calls.filter(([action]) => action?.type === "error")).toEqual([]);
  });

  for (const role of ["admin", "member"] as const) {
    it(`a folder action that still reaches the server says the neutral line, never red (${role})`, async () => {
      // Not yet known (no listing seen): the offer shows and its click meets the old server.
      const fetch = server087(role, routines);
      vi.stubGlobal("fetch", fetch);
      await mount(render());
      const sort = host.querySelector("[data-routine-prefix-sort]") as HTMLButtonElement;
      expect(sort).not.toBeNull();
      await act(async () => { sort.click(); });
      await flush();
      expect(fetch.mock.calls.some(([input]) => String(input).endsWith("/api/routines/folders"))).toBe(true);
      expect(host.querySelector("[data-routine-folder-server-note]")?.textContent).toBe(NEEDS_UPDATE);
      expect(shownErrors()).toEqual([]);
      expect(host.textContent).not.toMatch(/no route|admin scope/);
      expect(serverFeature("routineFolders")).toBe("no");
      // From then on the offer is gone and the row menu says why.
      expect(host.querySelector("[data-routine-prefix-offer]")).toBeNull();
    });
  }
});

describe("the person's own settings against a 0.8.7 server", () => {
  for (const role of ["admin", "member"] as const) {
    it(`Personal providers stay, disabled, with the neutral line (${role})`, async () => {
      vi.stubGlobal("fetch", server087(role));
      await mount(createElement(PersonalProviderKey, { provider: "elevenlabs", name: "ElevenLabs" }));
      expect(host.querySelector("[data-needs-server-update]")?.textContent).toContain(NEEDS_UPDATE);
      expect(host.querySelector("[data-personal-provider-key-input]")).toBeNull();
      expect(shownErrors()).toEqual([]);
    });
  }

  it("Show tool calls: a member's own switch says the neutral line, never the admin-scope refusal", async () => {
    fixture.state.config = { personalSettings: true, features: { showToolCalls: false }, viewer: { role: "member", operator: false } };
    vi.stubGlobal("fetch", server087("member"));
    await mount(createElement(ToolCallsRow));
    const toggle = host.querySelector('[role="switch"]') as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    await flush();
    expect(host.querySelector("[data-needs-server-update]")?.textContent).toBe(NEEDS_UPDATE);
    expect((host.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
    expect(shownErrors()).toEqual([]);
  });
});

it("names an older organization host instead of an admin or transport error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    error: "Your organization server needs an update to manage provider accounts.", code: "provider_accounts_update_required",
  }), { status: 409, headers: { "content-type": "application/json" } })));
  await mount(createElement(PersonalProviderKey, { provider: "openai", name: "OpenAI" }));
  expect(host.querySelector("[data-needs-server-update]")?.textContent).toBe(t("providers.organizationUpdate"));
  expect(host.querySelector("[data-personal-provider-key-input]")).toBeNull();
  expect(shownErrors()).toEqual([]);
});
