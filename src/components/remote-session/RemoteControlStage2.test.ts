// Tailcat stage 2: the control layer over the stage-1 read-only picture.
// Headless renders with a mocked frame cover every state; the live socket and
// input wiring are tested in use-remote-control's pure helpers.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import { controlSupportedOs } from "@/lib/remote-control-os";
import { RemoteControlSurface } from "./RemoteControlSurface";

const FRAME = "blob:frame-1";

function render(props: Partial<Parameters<typeof RemoteControlSurface>[0]> = {}) {
  return renderToStaticMarkup(createElement(RemoteControlSurface, {
    controllable: true,
    active: false,
    connecting: false,
    frameUrl: FRAME,
    error: null,
    missed: false,
    onToggle: () => undefined,
    ...props,
  }));
}

describe("controlSupportedOs", () => {
  it("is Windows only, matching the server", () => {
    expect(controlSupportedOs("windows")).toBe(true);
    expect(controlSupportedOs("macos")).toBe(false);
    expect(controlSupportedOs("linux")).toBe(false);
  });
});

describe("RemoteControlSurface", () => {
  afterEach(() => setLocale("en"));

  it("a Windows session shows a take-control toggle over a view-only picture", () => {
    setLocale("fr");
    const html = render({ active: false });
    expect(html).toContain('data-remote-input="none"');
    expect(html).toContain("data-remote-control-toggle");
    expect(html).toContain("Prendre le contrôle");
    expect(html).toContain("data-remote-session-shot");
    // not controlling: no active badge, the viewport is not focusable
    expect(html).not.toContain("Contrôle actif");
    expect(html).toContain('tabindex="-1"');
  });

  it("while controlling, the screen is marked control, carries a visible badge and takes focus", () => {
    setLocale("fr");
    const html = render({ active: true });
    expect(html).toContain('data-remote-input="control"');
    expect(html).toContain("Contrôle actif");
    expect(html).toContain("data-control-active");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Rendre le contrôle");
    expect(html).toContain('tabindex="0"');
    // the client-side hint tells the person their input goes to the remote computer
    expect(html).toContain(t("remoteControl.hint").replace(/'/g, "&#x27;"));
  });

  it("shows the connecting label while the socket opens", () => {
    expect(render({ connecting: true })).toContain(t("remoteControl.connecting"));
  });

  it("a non-Windows session stays view-only with a clear note and no toggle", () => {
    const html = render({ controllable: true, active: false, onToggle: undefined });
    expect(html).not.toContain("data-remote-control-toggle");
    const nonWindows = render({ controllable: false, onToggle: undefined });
    expect(nonWindows).toContain("data-remote-control-viewonly");
    expect(nonWindows).toContain(t("remoteControl.viewOnlyOs"));
    expect(nonWindows).not.toContain("data-remote-control-toggle");
  });

  it("surfaces an error line", () => {
    expect(render({ error: "boom" })).toContain("boom");
  });
});
