import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

vi.stubGlobal("window", {});
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
      state: {
        ...original.initialState,
        config: fixture.config ?? original.initialState.config,
        instances: [{
          instanceId: "test",
          driverKind: "grokAgent",
          displayName: "Grok",
          snapshot: { state: "available" },
          capabilities: { computerMcp: true, browserMcp: true },
        } as InstanceInfo],
      },
      dispatch: vi.fn(),
    }),
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({
    capabilities: {
      dictation: { available: false },
      host: { packaged: true, platform: "darwin" },
      localComputer: { available: true, support: "supported", enabled: true, status: "enabled" },
    },
    ready: true,
  }),
}));

const { PlaceChip, usePlaceAvailability } = await import("./PlaceChip");

/** The chip with its menu open (static render: no click). */
function PlaceMenuProbe({ bot: probeBot }: { bot: Bot }) {
  return createElement(PlaceChip, { bot: probeBot, live: false, onPin: () => {}, initialOpen: true });
}
afterAll(() => vi.unstubAllGlobals());

const bot = {
  id: "bot",
  threadId: "thread",
  name: "Rio",
  title: "",
  description: "",
  color: "green",
  notifications: true,
  unread: false,
  busy: false,
  messages: [],
  computer: "local",
  modelSelection: { instanceId: "test", model: "grok-4.6" },
} as Bot;

describe("PlaceChip composer trigger", () => {
  it("shows only the place icon, and keeps the place in the accessible name", () => {
    const html = renderToStaticMarkup(createElement(PlaceChip, {
      bot,
      live: false,
      onPin: () => {},
    } satisfies ComponentProps<typeof PlaceChip>));
    expect(html).toContain('data-testid="place-chip"');
    expect(html).not.toContain(">for this conversation<");
    expect(html).toContain('aria-label="Where this conversation works: This computer"');
    expect(html).toContain("This computer — From this bot&#x27;s Works on setting");
    expect(html).not.toMatch(/<span class="truncate">This computer<\/span>/);
  });

  it("stays clickable when Works on is off, and points at More > Computer", () => {
    const html = renderToStaticMarkup(createElement(PlaceChip, {
      bot: { ...bot, computer: "off" },
      live: false,
      onPin: () => {},
    } satisfies ComponentProps<typeof PlaceChip>));
    expect(html).toContain('data-testid="place-chip"');
    expect(html).not.toContain("disabled");
    expect(html).toContain("Change it in More, under Computer.");
  });
});

describe("the places a conversation can be pinned to", () => {
  const availability = () => {
    let seen: ReturnType<typeof usePlaceAvailability> | undefined;
    function Probe() { seen = usePlaceAvailability(bot); return null; }
    renderToStaticMarkup(createElement(Probe));
    return seen!;
  };
  afterEach(() => { fixture.config = null; fixture.organization = false; });

  it("reaches this computer and a Local VM on a desktop or self-hosted server", () => {
    // Cloud only while Boat Computer (or VPS Computer for a VPS bot) is on.
    expect(availability()).toMatchObject({ cloud: false, vm: true, local: true });
    fixture.config = { features: { skillAuthoring: true, boatComputer: true } };
    expect(availability()).toMatchObject({ cloud: true, vm: true, local: true });
  });

  it("ignores a leftover Cloud home flag", () => {
    fixture.config = { cloudHome: true };
    expect(availability()).toMatchObject({ cloud: false, vm: true, local: true });
  });
});

describe("the composer's place menu (regression: #54 left only Follow this bot's setting)", () => {
  afterEach(() => { fixture.config = null; fixture.organization = false; });
  const menuItems = (overrides: Partial<Bot> = {}) => {
    const html = renderToStaticMarkup(createElement(PlaceMenuProbe, { bot: { ...bot, computer: undefined, ...overrides } }));
    return [...html.matchAll(/<span class="block text-\[13px\] leading-\[18px\] text-ink">([^<]+)<\/span>/g)].map((match) => match[1]);
  };
  const FLAGS = [
    { features: {} },
    { features: { boatComputer: true } },
    { features: { vpsComputer: true } },
    { features: { boatComputer: true, vpsComputer: true } },
  ];

  it("on an organization server lists Cloud (the server environment) and the Local VM, whatever the VPS and Boat flags say", () => {
    fixture.organization = true;
    for (const config of FLAGS) {
      fixture.config = config;
      expect(menuItems()).toEqual(["Follow this bot&#x27;s setting", "Cloud (server environment)", "Local VM", "This computer"]);
    }
  });

  it("on an organization server says Auto means Cloud", () => {
    fixture.organization = true;
    const html = renderToStaticMarkup(createElement(PlaceMenuProbe, { bot: { ...bot, computer: undefined } }));
    expect(html).toContain("Currently Auto (Cloud)");
    expect(html).toContain("Your own Linux machine on the organization server");
  });

  it("on a solo server hides only Cloud while both flags are off, never the local places", () => {
    fixture.config = FLAGS[0];
    expect(menuItems()).toEqual(["Auto", "Local VM", "This computer"]);
    for (const config of FLAGS.slice(1)) {
      fixture.config = config;
      const items = menuItems(config.features.boatComputer ? {} : { cloudBackend: "vps" });
      expect(items).toEqual(["Auto", "Cloud computer", "Local VM", "This computer"]);
    }
  });
});
