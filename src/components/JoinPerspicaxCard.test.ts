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
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: EffectCallback) => {
    fixture.effects.push(effect);
  },
}));
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown>, api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: store.state, dispatch: vi.fn() }) }));
vi.mock("./SettingsPrimitives", () => ({ Card: ({ children }: { children: ReactNode }) => children }));
import { JoinPerspicaxCard } from "./JoinPerspicaxCard";

type Props = { children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; onChange?: (event: { target: { value: string; checked?: boolean } }) => void; disabled?: boolean; type?: string };
type Node = ReactElement<Props>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement(value)) return [];
  const node = value as Node;
  const children = typeof node.type === "function" ? (node.type as (props: Props) => ReactNode)(node.props) : node.props.children;
  return [node, ...Children.toArray(children).flatMap(nodes)];
}
function text(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(text).join("");
  return isValidElement(value) ? text((value as Node).props.children) : "";
}

const ORG = "https://bot.example.test";
const probe = vi.fn();
const join = vi.fn();
const stage = vi.fn();

function render() {
  fixture.index = 0;
  fixture.effects = [];
  let tree: ReactNode = null;
  function Capture() {
    tree = JoinPerspicaxCard();
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const submitButton = () => render().nodes.find((node) => node.type === "button" && node.props.type === "submit")!;
const typeAddress = (value: string) => render().nodes.find((node) => node.type === "input" && (node.props as { type?: string }).type === "url")!.props.onChange!({ target: { value } });
const submit = () => render().nodes.find((node) => node.type === "form")!.props.onSubmit!({ preventDefault() {} });

beforeEach(() => {
  fixture.values = [];
  store.api.mockReset();
  probe.mockReset().mockResolvedValue({ origin: ORG, issuer: "https://px.example.test" });
  join.mockReset().mockResolvedValue({ ok: true });
  stage.mockReset().mockResolvedValue({ ok: true });
  store.state = { bots: [{ id: "atlas", name: "Atlas" }], config: { viewer: { principalId: "local-owner" } } };
  vi.stubGlobal("window", { ogb: { orgJoin: { probe, join, stage } } });
  setLocale("en");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("join a Perspicax server", () => {
  it("joins without copying any bot", async () => {
    expect(submitButton().props.disabled).toBe(true);
    typeAddress(ORG);
    const button = submitButton();
    expect(button.props.disabled).toBe(false);
    expect(text(button.props.children)).toBe("Join");
    submit();
    await flush();
    expect(probe).toHaveBeenCalledExactlyOnceWith(ORG);
    expect(join).toHaveBeenCalledExactlyOnceWith({ origin: ORG });
    expect(store.api).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  it("joins even with no bot of one's own to offer", async () => {
    store.state = { ...store.state, bots: [] };
    expect(render().html).toContain("You have no bots of your own to copy.");
    typeAddress(ORG);
    submit();
    await flush();
    expect(join).toHaveBeenCalledExactlyOnceWith({ origin: ORG });
  });

  it("keeps copying the chosen bots", async () => {
    const atlas = render().nodes.find((node) => node.type === "input" && (node.props as { type?: string }).type === "checkbox")!;
    atlas.props.onChange!({ target: { value: "", checked: true } });
    typeAddress(ORG);
    expect(text(submitButton().props.children)).toBe("Join and copy");
    store.api.mockResolvedValue({ document: { fixture: true }, filename: "copy.json", summary: { bots: [], groups: [], routines: [], notCopied: [], redacted: 0 } });
    submit();
    await flush();
    expect(probe).toHaveBeenCalledExactlyOnceWith(ORG);
    expect(store.api).toHaveBeenCalledWith("/api/org/export", expect.objectContaining({ method: "POST" }));
    expect(stage).toHaveBeenCalledExactlyOnceWith({ origin: ORG, document: { fixture: true } });
    expect(join).not.toHaveBeenCalled();
  });

  it("says why when the server is not a Perspicax server", async () => {
    probe.mockRejectedValue(new Error("That server does not sign people in with Pulsatrix."));
    typeAddress(ORG);
    submit();
    await flush();
    expect(render().html).toContain("That server could not be joined");
    expect(join).not.toHaveBeenCalled();
  });

  it("in a browser, points to the desktop app and not to the hidden import card", () => {
    vi.stubGlobal("window", {});
    const html = render().html;
    expect(html).toContain("Download the copy file");
    expect(html).toContain("open this Sagax in the Sagax desktop app and use Join and copy");
    expect(html).not.toContain("Bring bots from a solo Sagax");
    setLocale("fr");
    const fr = render().html;
    expect(fr).toContain("Rejoindre et copier");
    expect(fr).not.toContain("Apporter des bots");
  });
});
