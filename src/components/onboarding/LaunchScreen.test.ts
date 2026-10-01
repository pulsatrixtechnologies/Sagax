import { Children, createElement, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useEffect: (effect: EffectCallback) => {
    fixture.effects.push(effect);
  },
}));
const store = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: {}, dispatch: store.dispatch }) }));
vi.mock("@/components/Avatar", () => ({ MausAvatar: () => null }));
import { LaunchScreen } from "./LaunchScreen";

type Props = { children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { value: string } }) => void; value?: string; disabled?: boolean; "data-mode"?: string };
type Node = ReactElement<Props>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

const probe = vi.fn();
const join = vi.fn();
const bridges = { environments: { state: vi.fn() }, orgJoin: { probe, join } };
const onSolo = vi.fn();

function render(initialMode?: "solo" | "server") {
  fixture.index = 0;
  fixture.effects = [];
  let tree: ReactNode = null;
  function Capture() {
    tree = LaunchScreen({ bridges: bridges as never, onSolo, initialMode });
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const mode = (id: string) => render().nodes.find((node) => node.props["data-mode"] === id)!;
const input = () => render().nodes.find((node) => node.type === "input")!;
const submit = () => render().nodes.find((node) => node.type === "form")!.props.onSubmit!({ preventDefault() {} });

beforeEach(() => {
  fixture.values = [];
  store.dispatch.mockReset();
  store.api.mockReset();
  store.api.mockResolvedValue({ onboarding: { launchMode: "solo" } });
  probe.mockReset();
  join.mockReset();
  onSolo.mockReset();
  setLocale("en");
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("launch screen", () => {
  it("offers no server and server, without a Skip, and the product name", () => {
    const html = render().html;
    expect(html).toContain("Welcome to Sagax");
    expect(html).toContain("No server");
    expect(html).toContain("Server");
    expect(html).not.toContain("Skip");
    expect(html).toContain("role=\"dialog\"");
    // no address field until server mode is chosen
    expect(render().nodes.some((node) => node.type === "input")).toBe(false);
  });

  it("no server is remembered, and the tour goes on", async () => {
    mode("solo").props.onClick!();
    submit();
    expect(onSolo).toHaveBeenCalledOnce();
    await flush();
    expect(store.api).toHaveBeenCalledWith("/api/config", expect.objectContaining({ method: "PUT", body: JSON.stringify({ onboarding: { launchMode: "solo" } }) }));
    expect(store.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: { onboarding: { launchMode: "solo" } } });
    expect(probe).not.toHaveBeenCalled();
    expect(join).not.toHaveBeenCalled();
  });


  it("server mode prefills the default address, checks the server, saves it and starts Sign in with Pulsatrix", async () => {
    mode("server").props.onClick!();
    expect(input().props.value).toBe("https://bot.pulsatrix.mcp.goxcloud.ca");
    expect(render().html).toContain("Sign in");
    probe.mockResolvedValue({ origin: "https://bot.pulsatrix.mcp.goxcloud.ca", issuer: "https://px.example.test" });
    join.mockResolvedValue({ ok: true });
    submit();
    await flush();
    expect(probe).toHaveBeenCalledExactlyOnceWith("https://bot.pulsatrix.mcp.goxcloud.ca");
    expect(store.api).toHaveBeenCalledWith("/api/config", expect.objectContaining({ body: JSON.stringify({ onboarding: { launchMode: "server" } }) }));
    expect(join).toHaveBeenCalledExactlyOnceWith({ origin: "https://bot.pulsatrix.mcp.goxcloud.ca" });
    expect(onSolo).not.toHaveBeenCalled();
  });

  it("uses another address the person types", async () => {
    mode("server").props.onClick!();
    input().props.onChange!({ target: { value: "sagax.example.test" } });
    probe.mockResolvedValue({ origin: "https://sagax.example.test", issuer: "https://px.example.test" });
    join.mockResolvedValue({ ok: true });
    submit();
    await flush();
    expect(probe).toHaveBeenCalledExactlyOnceWith("https://sagax.example.test");
    expect(join).toHaveBeenCalledExactlyOnceWith({ origin: "https://sagax.example.test" });
  });

  it("refuses an address that is not https before asking anything", async () => {
    render("server");
    input().props.onChange!({ target: { value: "http://sagax.example.test" } });
    submit();
    await flush();
    expect(probe).not.toHaveBeenCalled();
    expect(render().html).toContain("Enter an https address");
  });

  it("says when the server cannot be reached, and saves nothing", async () => {
    render("server");
    probe.mockRejectedValue(new Error("Error invoking remote method 'org-join:probe': Error: That server could not be reached."));
    submit();
    await flush();
    const html = render().html;
    expect(html).toContain("That server could not be reached");
    expect(html).not.toContain("invoking");
    expect(join).not.toHaveBeenCalled();
    expect(store.api).not.toHaveBeenCalled();
  });

  it("says when the server is not linked to Perspicax", async () => {
    render("server");
    probe.mockRejectedValue(new Error("That server does not sign people in with Pulsatrix."));
    submit();
    await flush();
    expect(render().html).toContain("not linked to Pulsatrix");
    expect(join).not.toHaveBeenCalled();
  });

  it("says when the sign-in could not start", async () => {
    render("server");
    probe.mockResolvedValue({ origin: "https://bot.pulsatrix.mcp.goxcloud.ca", issuer: "https://px.example.test" });
    join.mockRejectedValue(new Error("secret /path"));
    submit();
    await flush();
    const html = render().html;
    expect(html).toContain("Could not connect");
    expect(html).not.toContain("secret");
  });
});
