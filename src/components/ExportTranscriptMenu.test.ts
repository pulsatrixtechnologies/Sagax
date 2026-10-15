// @vitest-environment happy-dom
// The conversation's one "..." button (JC, 2026-10-14): share and export,
// then the Inspector and the Data window when they are on. It replaces the
// header's separate Share, Inspector, Data and panel buttons.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";

let root: Root | null = null;
const render = (props: Partial<Parameters<typeof ExportTranscriptMenu>[0]> = {}) => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const messages = [{ id: "m1", role: "user", text: "Hello", at: 1 }] as unknown as Message[];
  flushSync(() => root!.render(createElement(ExportTranscriptMenu, { title: "Scout", messages, botName: "Scout", ...props })));
  return container;
};
const open = (container: HTMLElement) => {
  flushSync(() => container.querySelector<HTMLButtonElement>("[data-conversation-menu]")!.click());
  return [...container.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map((item) => item.textContent?.trim());
};
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  setLocale("en");
});

describe("the conversation's ... menu", () => {
  it("is one round button named More options, not a Share icon", () => {
    const container = render();
    const button = container.querySelector<HTMLButtonElement>("[data-conversation-menu]")!;
    expect(button.getAttribute("aria-label")).toBe("More options");
    expect(button.querySelector("svg.lucide-ellipsis, svg.lucide-more-horizontal")).not.toBeNull();
  });

  it("lists the transcript exports, then the bot zip, the Inspector and Data when given", () => {
    const onExportBot = vi.fn();
    const onToggleInspector = vi.fn();
    const onOpen = vi.fn();
    const container = render({ onExportBot, onToggleInspector, inspectorOpen: true, data: { label: "Open the Data window", onOpen } });
    expect(open(container)).toEqual(["Copy as Markdown", "Download as .md", "Export the bot (.zip)", "Inspector", "Open the Data window"]);
    expect(container.querySelector("[data-conversation-inspector]")!.getAttribute("aria-checked")).toBe("true");
    flushSync(() => container.querySelector<HTMLButtonElement>("[data-data-window-button]")!.click());
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("leaves out what is off: no Inspector in Simple mode, no Data without the experiment", () => {
    expect(open(render())).toEqual(["Copy as Markdown", "Download as .md"]);
  });

  it("says it in French", () => {
    setLocale("fr");
    const container = render({ onToggleInspector: vi.fn() });
    expect(container.querySelector("[data-conversation-menu]")!.getAttribute("aria-label")).toBe("Plus d'options");
    expect(open(container)).toEqual(["Copier en Markdown", "Télécharger en .md", "Inspecteur"]);
  });
});
