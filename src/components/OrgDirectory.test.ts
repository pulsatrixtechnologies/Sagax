import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgDirectory } from "./OrgDirectory";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next;
    }];
  },
}));

// renderToStaticMarkup HTML-escapes apostrophes as &#x27;. Decode before
// comparing against the UI label.
function text(html: string): string {
  return html.replace(/&#x27;/g, "'");
}

type Node = ReactElement<{ children?: ReactNode; type?: string; value?: string; onChange?: (event: unknown) => void; onSubmit?: (event: unknown) => void | Promise<void> }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

function render(props: Parameters<typeof OrgDirectory>[0]) {
  fixture.index = 0;
  const tree = OrgDirectory(props);
  const html = text(renderToStaticMarkup(tree));
  return { html, nodes: nodes(tree) };
}

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
});

describe("OrgDirectory", () => {
  it("offers creation when there is no organization", () => {
    const html = render({ org: null, people: [], onCreate() {}, onInvite() {} }).html;
    expect(html).toContain("Créer l'organisation");
  });
  it("lists members once the organization exists", () => {
    const html = render({
      org: { name: "GOX" },
      people: [{ id: "zachary@example.test", role: "member" }],
      onCreate() {},
      onInvite() {},
    }).html;
    expect(html).toContain("GOX");
    expect(html).toContain("zachary@example.test");
    expect(html).not.toContain("Créer l'organisation");
  });
  it("shows a pending invite separately from members", () => {
    const html = render({
      org: { name: "GOX" },
      people: [],
      pendingInvites: [{ email: "zachary@example.test" }],
      onCreate() {},
      onInvite() {},
    }).html;
    expect(html).toContain("Invitations en attente");
    expect(html).toContain("zachary@example.test");
    expect(html).toContain("après avoir accepté");
  });
  it("keeps the invite address when onInvite fails", async () => {
    const onInvite = vi.fn(() => Promise.reject(new Error("forbidden")));
    const props = { org: { name: "GOX" }, people: [] as { id: string; role: "member" }[], onCreate() {}, onInvite };
    render(props).nodes.find((node) => node.type === "input")!.props.onChange!({ target: { value: "zachary@example.test" } });
    await render(props).nodes.find((node) => node.type === "form")!.props.onSubmit!({ preventDefault() {} });
    expect(onInvite).toHaveBeenCalledExactlyOnceWith("zachary@example.test");
    expect(render(props).nodes.find((node) => node.type === "input")!.props.value).toBe("zachary@example.test");
  });
  it("clears the invite address after onInvite succeeds", async () => {
    const onInvite = vi.fn(() => Promise.resolve());
    const props = { org: { name: "GOX" }, people: [] as { id: string; role: "member" }[], onCreate() {}, onInvite };
    render(props).nodes.find((node) => node.type === "input")!.props.onChange!({ target: { value: "zachary@example.test" } });
    await render(props).nodes.find((node) => node.type === "form")!.props.onSubmit!({ preventDefault() {} });
    expect(render(props).nodes.find((node) => node.type === "input")!.props.value).toBe("");
  });
});
