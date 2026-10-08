import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { applyPresenceList, resetPresence } from "@/lib/presence";
import { PersonAvatar } from "./MessageAuthor";
import { PresenceDot, presenceDotSize } from "./PresenceDot";

afterEach(() => resetPresence());

describe("PresenceDot", () => {
  it("draws nothing where there is no presence", () => {
    expect(renderToStaticMarkup(createElement(PresenceDot, { principalId: "pr_bob" }))).toBe("");
    expect(renderToStaticMarkup(createElement(PersonAvatar, { initials: "BO", presenceId: "pr_bob" }))).not.toContain("data-presence");
  });

  it("green online, amber away, grey offline, each with its words as name and tooltip", () => {
    const at = Date.now() - 2 * 3_600_000 - 1_000;
    applyPresenceList([
      { principalId: "pr_on", state: "online", lastSeenAt: Date.now() },
      { principalId: "pr_away", state: "away", lastSeenAt: Date.now() },
      { principalId: "pr_off", state: "offline", lastSeenAt: at },
      { principalId: "pr_hidden", state: "offline", lastSeenAt: null },
    ]);
    const on = renderToStaticMarkup(createElement(PresenceDot, { principalId: "pr_on" }));
    expect(on).toContain('data-presence="online"');
    expect(on).toContain("bg-success");
    expect(on).toContain('role="img"');
    expect(on).toContain('aria-label="Online"');
    expect(on).toContain('title="Online"');
    const away = renderToStaticMarkup(createElement(PresenceDot, { principalId: "pr_away" }));
    expect(away).toContain("bg-warning");
    expect(away).toContain('aria-label="Away"');
    const off = renderToStaticMarkup(createElement(PresenceDot, { principalId: "pr_off" }));
    expect(off).toContain("bg-ink-secondary/55");
    expect(off).toContain('title="Offline, last seen 2 h ago"');
    expect(renderToStaticMarkup(createElement(PresenceDot, { principalId: "pr_hidden" }))).toContain('title="Offline"');
  });

  it("sits on the avatar's corner, sized to it", () => {
    applyPresenceList([{ principalId: "pr_on", state: "online", lastSeenAt: 1 }]);
    const markup = renderToStaticMarkup(createElement(PersonAvatar, { initials: "ON", size: 36, presenceId: "pr_on", presenceRing: "border-sidebar" }));
    expect(markup).toMatch(/^<span class="relative inline-flex shrink-0">/);
    expect(markup).toContain("absolute -bottom-0.5 -right-0.5");
    expect(markup).toContain("border-sidebar");
    expect(presenceDotSize(24)).toBe("size-2");
    expect(presenceDotSize(36)).toBe("size-2.5");
    expect(presenceDotSize(88)).toBe("size-3");
  });
});
