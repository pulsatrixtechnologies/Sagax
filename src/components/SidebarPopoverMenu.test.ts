import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

// Drawn open: the menu's own motion and dismissal are not what is tested here.
vi.mock("./MenuMotion", () => ({ useMenuMotion: () => ({ shown: true, exitProps: {}, className: "" }) }));
vi.mock("@/hooks/use-popover-dismiss", () => ({ usePopoverDismiss: () => {} }));
import { SidebarPopoverMenu } from "./SidebarPopoverMenu";

const render = (items: Parameters<typeof SidebarPopoverMenu>[0]["items"]) =>
  renderToStaticMarkup(createElement(SidebarPopoverMenu, { items, ariaLabel: "Menu", renderTrigger: () => "trigger" }));

it("draws an item's second line (where it connects) and third line (a note) under its label", () => {
  const html = render([
    { key: "cloud", label: "Connect your phone", subtitle: "to your Cloud (always on)", onSelect: () => {} },
    { key: "here", label: "Connect your phone", subtitle: "to this computer", note: "Your Cloud shows here once it is ready.", onSelect: () => {} },
    { key: "plain", label: "Settings", onSelect: () => {} },
  ]);
  expect(html).toMatch(/Connect your phone<\/span><span[^>]*>to your Cloud \(always on\)<\/span>/);
  expect(html).toMatch(/to this computer<\/span><span[^>]*>Your Cloud shows here once it is ready\.<\/span>/);
  expect(html.indexOf("to your Cloud (always on)")).toBeLessThan(html.indexOf("to this computer"));
  expect(html).toContain('<span class="flex-1 truncate">Settings</span>');
});
