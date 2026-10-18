// The foot's update button beside Connect apps: which updater states show
// it, what it says, and that only a ready update takes a click (it opens
// the "Update ready" dialog with the release notes, as before).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdaterState } from "@/lib/updater";
import { setLocale } from "@/lib/i18n";

vi.mock("@/lib/brand", () => ({ brand: () => ({ name: "Sagax" }) }));

import { updatePillView, UpdatePillButton } from "./SidebarUpdatePill";
import { footPillCovers } from "./SidebarProfileMenu";

const tag = (html: string) => /<button[^>]*>/.exec(html)?.[0] ?? "";

afterEach(() => setLocale("en"));

describe("updatePillView", () => {
  it("stays away with no bridge, while idle, checking, failed or handed off", () => {
    expect(updatePillView(null)).toBeNull();
    for (const status of ["idle", "checking", "error", "handed-off"] as const) {
      expect(updatePillView({ status })).toBeNull();
    }
  });

  it("reports a download's progress, clamped and rounded", () => {
    expect(updatePillView({ status: "downloading", percent: 41.6 })).toMatchObject({ kind: "progress", percent: 42, text: "42%", aria: "Downloading… 42%" });
    expect(updatePillView({ status: "downloading", percent: 140 })).toMatchObject({ percent: 100 });
    expect(updatePillView({ status: "downloading" })).toMatchObject({ kind: "progress", percent: null, text: "0%", aria: "Starting download…" });
  });

  it("spins while the update is staged or installs", () => {
    expect(updatePillView({ status: "preparing" })).toMatchObject({ kind: "busy", text: "Preparing…", aria: "Preparing update…" });
    expect(updatePillView({ status: "installing" })).toMatchObject({ kind: "busy", text: "Restarting…", aria: "Restarting to update…" });
    expect(updatePillView({ status: "installing", installMode: "handoff" })).toMatchObject({ aria: "Opening a terminal…" });
  });

  it("says Update for a ready update, its label naming the version", () => {
    expect(updatePillView({ status: "downloaded", version: "0.5.21" })).toEqual({
      kind: "ready",
      text: "Update",
      aria: "Update Sagax to version 0.5.21",
      version: "0.5.21",
    });
    expect(updatePillView({ status: "downloaded" })).toMatchObject({ aria: "Update", version: null });
  });

  it("speaks French", () => {
    setLocale("fr");
    expect(updatePillView({ status: "downloaded", version: "0.5.21" })).toMatchObject({
      text: "Mettre à jour",
      aria: "Mettre à jour Sagax vers la version 0.5.21",
    });
  });

  it("covers exactly the phases the avatar's dot leaves to it", () => {
    for (const status of ["downloading", "preparing", "downloaded", "installing"] as const) {
      expect(updatePillView({ status } as UpdaterState)).not.toBeNull();
      expect(footPillCovers(status)).toBe(true);
    }
    for (const phase of ["idle", "checking", "error", "handed-off", "up-to-date"] as const) {
      expect(footPillCovers(phase)).toBe(false);
    }
  });
});

describe("UpdatePillButton", () => {
  it("is a labelled button with its word, wide only when announced", () => {
    const view = updatePillView({ status: "downloaded", version: "0.5.21" })!;
    const html = renderToStaticMarkup(createElement(UpdatePillButton, { view }));
    expect(tag(html)).toContain('aria-label="Update Sagax to version 0.5.21"');
    expect(tag(html)).toContain('data-sidebar-update-pill="ready"');
    expect(tag(html)).not.toContain("aria-disabled");
    expect(tag(html)).not.toContain("data-wide");
    expect(html).toContain(">Update</span>");
    expect(html).toContain("lucide-cloud-download");
    const wide = renderToStaticMarkup(createElement(UpdatePillButton, { view, wide: true }));
    expect(tag(wide)).toContain("data-wide");
  });

  it("draws the download as a ring and takes no click", () => {
    const view = updatePillView({ status: "downloading", percent: 40 })!;
    const html = renderToStaticMarkup(createElement(UpdatePillButton, { view }));
    expect(tag(html)).toContain('data-percent="40"');
    expect(tag(html)).toContain('aria-disabled="true"');
    expect(tag(html)).toContain('aria-busy="true"');
    expect(html).toContain("data-update-ring");
  });

  it("opens the update dialog on click when ready, and only then", () => {
    const onOpen = vi.fn();
    const click = (view: NonNullable<ReturnType<typeof updatePillView>>) => {
      const element = UpdatePillButton({ view, onOpen }) as { props: { onClick: (event: { stopPropagation: () => void }) => void } };
      element.props.onClick({ stopPropagation: () => {} });
    };
    click(updatePillView({ status: "downloading", percent: 10 })!);
    expect(onOpen).not.toHaveBeenCalled();
    click(updatePillView({ status: "downloaded", version: "0.5.21" })!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
