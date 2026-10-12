import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SidebarMascotAvatar } from "./SidebarMascotAvatar";

vi.mock("./Avatar", () => ({
  BotAvatar: ({ sidebarAlive }: { sidebarAlive?: boolean }) =>
    createElement("span", { "data-mock-avatar": "", "data-sidebar-alive": sidebarAlive ? "1" : "0" }),
  InitialsAvatar: () => createElement("span"),
}));

describe("SidebarMascotAvatar", () => {
  it("marks the avatar alive when the row mascot is idle", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarMascotAvatar, {
        botId: "b1",
        bot: { name: "Scout", color: "green" },
        size: 36,
        animated: false,
      }),
    );
    expect(html).toContain("data-sidebar-mascot");
    expect(html).toContain('data-sidebar-alive="1"');
  });

  it("does not enable sidebar gaze while the row is fully animated", () => {
    const html = renderToStaticMarkup(
      createElement(SidebarMascotAvatar, {
        botId: "b1",
        bot: { name: "Scout", color: "green" },
        size: 36,
        animated: true,
      }),
    );
    expect(html).toContain('data-sidebar-alive="0"');
  });
});
