import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Clicks through the inline editor without a DOM, as ModelPicker's
// interaction test does: useState is held here by call order, effects never
// run, and handlers are read off the returned element.
const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
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
  useRef: () => ({ current: null }),
}));

import { InlineEditableText, inlineEditCommit } from "./InlineEditableText";

type Props = Parameters<typeof InlineEditableText>[0];
const render = (props: Props) => {
  fixture.index = 0;
  return InlineEditableText(props) as ReactElement<Record<string, (...args: unknown[]) => void> & { value?: string }>;
};
const key = (name: string) => ({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn(), nativeEvent: {}, currentTarget: { blur: vi.fn() } });

beforeEach(() => { fixture.values = []; });
afterEach(() => vi.clearAllMocks());

describe("inline editable text", () => {
  it("reads as text with a pencil, and as nothing when read-only and empty", () => {
    const html = renderToStaticMarkup(createElement(InlineEditableText, { value: "Pepper", ariaLabel: "Edit name", onSave: () => {} }));
    expect(html).toContain('data-inline-edit="text"');
    expect(html).toContain("Pepper");
    expect(renderToStaticMarkup(createElement(InlineEditableText, { value: "", ariaLabel: "Edit label" }))).toBe("");
  });

  it("shows the muted placeholder when there is no label yet", () => {
    const html = renderToStaticMarkup(createElement(InlineEditableText, { value: "", placeholder: "Add a label", ariaLabel: "Edit label", onSave: () => {} }));
    expect(html).toContain("Add a label");
    expect(html).toContain("text-ink-secondary");
  });

  it("turns into a field on click and saves the trimmed text on Enter", () => {
    const onSave = vi.fn();
    const props: Props = { value: "Pepper", ariaLabel: "Edit name", onSave, required: true };
    render(props).props.onClick!();
    let field = render(props);
    expect(field.type).toBe("input");
    expect(field.props.value).toBe("Pepper");
    field.props.onChange!({ target: { value: "  Salt  " } });
    field = render(props);
    const enter = key("Enter");
    field.props.onKeyDown!(enter);
    expect(enter.currentTarget.blur).toHaveBeenCalled();
    field.props.onBlur!();
    expect(onSave).toHaveBeenCalledWith("Salt");
    expect(render(props).type).toBe("button");
  });

  it("cancels on Escape without closing the panel or saving", () => {
    const onSave = vi.fn();
    const props: Props = { value: "Pepper", ariaLabel: "Edit name", onSave };
    render(props).props.onClick!();
    render(props).props.onChange!({ target: { value: "Changed" } });
    const escape = key("Escape");
    render(props).props.onKeyDown!(escape);
    expect(escape.stopPropagation).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(render(props).type).toBe("button");
    render(props).props.onClick!();
    expect(render(props).props.value).toBe("Pepper");
  });

  it("refuses an empty name, clears a label, and skips an unchanged value", () => {
    expect(inlineEditCommit("   ", "Pepper", { required: true })).toBeNull();
    expect(inlineEditCommit("", "Ops lead", { required: false })).toBe("");
    expect(inlineEditCommit(" Pepper ", "Pepper", { required: true })).toBeNull();
  });
});
