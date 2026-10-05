import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, ConfigStatus } from "@/state/store";
import { worksOnModes, WorksOnControl, WorksOnSetting, worksOnTip } from "./WorksOnSetting";

const fixture = vi.hoisted(() => ({ config: null as unknown, organization: false }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => (fixture.organization ? { org: { identity: { kind: "perspicax" } } } : null),
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, config: fixture.config ?? original.initialState.config },
      dispatch: vi.fn(),
    }),
  };
});
vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({
    capabilities: {
      host: { packaged: true, platform: "darwin" },
      localComputer: { available: true, support: "supported", enabled: true, status: "enabled" },
    },
    ready: true,
  }),
}));

beforeEach(() => { vi.stubGlobal("window", {}); fixture.config = null; fixture.organization = false; });
afterEach(() => vi.unstubAllGlobals());

const labels = (markup: string) => [...markup.matchAll(/data-works-on-choice="([^"]+)"[^>]*>([^<]*)</g)].map((match) => match[2]);

function control(config: Partial<ConfigStatus> | null, organization: boolean, value: Bot["computer"] | null = null) {
  return renderToStaticMarkup(createElement(WorksOnControl, {
    value,
    organization,
    modes: worksOnModes(config, organization),
    disabled: {},
    onChange: () => {},
  }));
}

describe("one Works on control", () => {
  it("offers this computer and a Local VM on a desktop or self-hosted server", () => {
    expect(labels(control(null, false))).toEqual(["Auto", "Local VM", "This computer", "Browser", "Off"]);
    expect(labels(control({}, false))).toEqual(["Auto", "Local VM", "This computer", "Browser", "Off"]);
    expect(labels(control({ features: { skillAuthoring: true, boatComputer: true } }, false))).toEqual(["Auto", "Cloud computer", "Local VM", "This computer", "Browser", "Off"]);
  });

  it("keeps local places when a leftover Cloud home flag is present", () => {
    expect(labels(control({ cloudHome: true } as Partial<ConfigStatus>, false))).toEqual(["Auto", "Local VM", "This computer", "Browser", "Off"]);
  });

  it("names every place on an organization server the way the composer chip does", () => {
    expect(labels(control({}, true))).toEqual(["Auto (Cloud)", "Cloud (server environment)", "Local VM", "This computer", "Browser", "Off"]);
    expect(worksOnTip(null, null, false)).toBe("Choose automatically");
    expect(worksOnTip(null)).toMatch(/^Starts in your server environment \(Cloud\); the bot may switch/);
  });

  it("says why an option is disabled, in the tooltip", () => {
    const markup = renderToStaticMarkup(createElement(WorksOnControl, {
      value: null,
      organization: false,
      modes: worksOnModes(null, false),
      disabled: { local: "Local computer control requires the desktop app.", browser: "The built-in browser needs the Sagax desktop app" },
      onChange: () => {},
    }));
    expect(markup).toContain('title="This computer is not available: Local computer control requires the desktop app."');
    expect(markup).toContain('title="Browser is not available: The built-in browser needs the Sagax desktop app"');
  });

  it("hides the control from an organization member who cannot save where the bot works", () => {
    const bot = {
      id: "bot-1", threadId: "thread-1", name: "Scout", title: "Scout", description: "",
      notifications: false, color: "green", unread: false, messages: [],
      modelSelection: { instanceId: "local", model: "test-model" },
      ownerUserId: "owner",
    } as Bot;
    fixture.config = { viewer: { role: "member", operator: false, principalId: "ada" } } as Partial<ConfigStatus>;
    expect(renderToStaticMarkup(createElement(WorksOnSetting, { bot }))).toBe("");
    fixture.config = null;
    expect(renderToStaticMarkup(createElement(WorksOnSetting, { bot }))).toContain('data-works-on-setting="auto"');
  });
});
