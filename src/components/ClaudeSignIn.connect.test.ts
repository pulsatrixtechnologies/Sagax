import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The first sign-in registers at once (2026-10-09): pasting the code used to
// end on "This sign-in is no longer available" and a Connect button, because
// the server released the flow when the code went through and the card then
// asked /status for it (404). Drives the real card without a DOM: useState
// is held by call order, handlers are read off the returned tree.
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  return {
    values: [] as unknown[],
    index: 0,
    calls: [] as Array<{ path: string; method: string }>,
    answers: new Map<string, () => unknown>(),
  };
});
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useEffect: () => {},
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ refreshInstances: vi.fn(), refreshModels: vi.fn() }),
    api: vi.fn(async (path: string, init?: { method?: string }) => {
      fixture.calls.push({ path, method: init?.method ?? "GET" });
      const route = [...fixture.answers.keys()].find((prefix) => path.includes(prefix));
      if (!route) throw new original.ApiError("This sign-in is no longer available in this browser. Start a new sign-in.", 404);
      return fixture.answers.get(route)!();
    }),
  };
});

const { ClaudeSignIn } = await import("./ClaudeSignIn");
afterAll(() => vi.unstubAllGlobals());

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(value: ReactNode): Node[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as Node;
    return [node, ...nodes(node.props.children)];
  });
}

const base = "/api/me/engines/claude/login";
function render(onSignedIn: () => Promise<unknown>) {
  let tree: ReactNode = null;
  function Capture() {
    fixture.index = 0;
    tree = ClaudeSignIn({ instanceId: "claude", base, onSignedIn });
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
const button = (rendered: ReturnType<typeof render>, text: string) =>
  rendered.nodes.find((node) => node.type === "button" && Children.toArray(node.props.children).some((child) => typeof child === "string" && child.includes(text)))!;

beforeEach(() => {
  fixture.values = [];
  fixture.calls = [];
  fixture.answers = new Map();
});

describe("connecting Claude the first time", () => {
  it("shows Connected and reloads the person's engines as soon as the code goes through, with one click", async () => {
    const waiting = { phase: "waiting", flowId: "flow-1", authorizationUrl: "https://claude.com/cai/oauth/authorize?x=1", expiresAt: null };
    fixture.answers.set(`${base}/start`, () => ({ auth: waiting }));
    // The server's answer once Claude Code confirmed the sign-in. Its flow is
    // already released, which is what made /status answer 404.
    fixture.answers.set(`${base}/complete`, () => ({ ok: true }));
    const onSignedIn = vi.fn(async () => undefined);

    const start = button(render(onSignedIn), "Connect Claude");
    await (start.props.onClick as () => Promise<void>)();
    const codeStep = render(onSignedIn);
    const input = codeStep.nodes.find((node) => node.type === "input")!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "pasted-code-1234#state" } });
    const finish = render(onSignedIn).nodes.find((node) => node.type === "button" && node.props.disabled === false && typeof node.props.onClick === "function" && node !== start)!;
    await (finish.props.onClick as () => Promise<void>)();

    expect(onSignedIn).toHaveBeenCalledOnce();
    const after = render(onSignedIn).html;
    expect(after).toContain('role="status"');
    expect(after).not.toContain("Connect Claude");
    expect(after).not.toContain("no longer available");
    expect(fixture.calls.filter((call) => call.path.includes("/start"))).toHaveLength(1);
  });

  it("keeps the code step and says why when Anthropic refuses the code", async () => {
    const waiting = { phase: "waiting", flowId: "flow-2", authorizationUrl: "https://claude.com/cai/oauth/authorize?x=2", expiresAt: null };
    fixture.answers.set(`${base}/start`, () => ({ auth: waiting }));
    fixture.answers.set(`${base}/complete`, () => { throw new Error("Anthropic did not accept that code."); });
    const onSignedIn = vi.fn(async () => undefined);
    await (button(render(onSignedIn), "Connect Claude").props.onClick as () => Promise<void>)();
    const input = render(onSignedIn).nodes.find((node) => node.type === "input")!;
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "wrong-code-1234" } });
    const rendered = render(onSignedIn);
    const finish = rendered.nodes.filter((node) => node.type === "button" && node.props.disabled === false)[0]!;
    await (finish.props.onClick as () => Promise<void>)();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(render(onSignedIn).html).toContain("Anthropic did not accept that code.");
  });
});
