import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Card, SettingRow, Switch, SwitchRow } from "./SettingsPrimitives";

describe("settings primitives", () => {
  it("lays out a labeled setting and keeps its status outside the control column", () => {
    const html = renderToStaticMarkup(createElement(SettingRow, {
      title: "Language",
      subtitle: "Choose your app language.",
      children: createElement("select", { "aria-label": "App language" }, createElement("option", null, "English")),
      message: createElement("p", { role: "alert" }, "Could not save"),
    }));
    expect(html).toMatch(/role="group" aria-labelledby="[^"]+"/);
    expect(html).toContain("sm:grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("sm:gap-4");
    expect(html).toContain('aria-label="App language"');
    expect(html).toContain('<p role="alert">Could not save</p>');
    expect(html).not.toContain("bg-card");
  });

  it("keeps the form card surface and native switch semantics", () => {
    const html = renderToStaticMarkup(createElement(Card, {
      title: "Profile",
      children: createElement(Switch, { checked: true, disabled: true, "aria-label": "Analytics" }),
    }));
    expect(html).toContain("rounded-[14px] border-[0.5px] border-border");
    expect(html).not.toContain("bg-card");
    expect(html).toContain('type="button" role="switch" aria-checked="true"');
    expect(html).toContain('aria-label="Analytics"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("motion-reduce:transition-none");
  });
});

describe("SwitchRow", () => {
  it("is a label around the text and a role=switch button", () => {
    const markup = renderToStaticMarkup(createElement(SwitchRow, { label: "Enable", description: "Help", checked: false, onChange: () => {} }));
    expect(markup.startsWith("<label")).toBe(true);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain("Help");
  });

  it("clicking the switch reports the opposite of the current state", () => {
    const onChange = vi.fn();
    const tree = SwitchRow({ label: "Enable", checked: true, onChange }) as any;
    const sw = (Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children]).find((c: any) => c && c.type === Switch);
    sw.props.onClick();
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
