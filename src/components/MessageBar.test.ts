// @vitest-environment happy-dom
// The bar beside a message holds the copy button, the "…" and the time. Every
// other control is a labelled entry in the "…" menu, so the column stays two
// buttons wide.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { MessageBar, MessageMenuItem } from "./MessageBar";

let host: HTMLDivElement;
let root: Root;
const bar = () => host.querySelector<HTMLElement>("[data-message-bar]")!;
const handle = () => bar().querySelector<HTMLButtonElement>('button[aria-label="Message actions"]')!;
const items = () => [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => item.textContent);

async function render(side: "bot" | "user" = "bot", onSelect = vi.fn()) {
  await act(async () => {
    root.render(
      createElement(MessageBar, {
        side,
        time: "1:54 PM",
        copy: createElement("button", { type: "button", "aria-label": "Copy message" }),
        children: [
          createElement(MessageMenuItem, { key: "raw", label: "Show raw markdown", icon: null, onSelect }),
          createElement(MessageMenuItem, { key: "speak", label: "Read this aloud", icon: null, onSelect: () => {} }),
          createElement(MessageMenuItem, { key: "regen", label: "Regenerate response", icon: null, onSelect: () => {} }),
          createElement(MessageMenuItem, { key: "edit", label: "Edit message", icon: null, onSelect: () => {} }),
        ],
      }),
    );
  });
  return onSelect;
}

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("MessageBar", () => {
  it("shows only the time, copy and the … handle, with no menu open", async () => {
    await render();
    const buttons = [...bar().querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
    expect(buttons).toEqual(["Copy message", "Message actions"]);
    expect(bar().textContent).toContain("1:54 PM");
    expect(items()).toEqual([]);
    expect(handle().getAttribute("aria-haspopup")).toBe("menu");
    expect(handle().getAttribute("aria-expanded")).toBe("false");
  });

  it("holds the other controls in the … menu, with their labels", async () => {
    await render();
    await act(async () => handle().click());
    expect(handle().getAttribute("aria-expanded")).toBe("true");
    expect(items()).toEqual(["Show raw markdown", "Read this aloud", "Regenerate response", "Edit message"]);
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("runs an entry and closes the menu", async () => {
    const onSelect = await render();
    await act(async () => handle().click());
    await act(async () => host.querySelector<HTMLElement>('[role="menuitem"]')!.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(handle().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape", async () => {
    await render();
    await act(async () => handle().click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(handle().getAttribute("aria-expanded")).toBe("false");
  });

  it("never grows past the copy button, the handle and the time, on either side", async () => {
    for (const side of ["bot", "user"] as const) {
      await render(side);
      // stacked, not in a row: the time sits under the two buttons
      expect(bar().className).toContain("flex-col");
      expect(bar().className).toContain("shrink-0");
      expect(bar().querySelector("[data-message-time]")!.className).toContain("whitespace-nowrap");
      // the menu opens over the message, anchored to the edge away from the screen edge
      await act(async () => handle().click());
      const menu = host.querySelector('[role="menu"]')!;
      expect(menu.className).toContain(side === "bot" ? "right-0" : "left-0");
      expect(menu.className).toContain("max-w-[min(16rem,calc(100vw-2rem))]");
      await act(async () => handle().click());
    }
  });
});
