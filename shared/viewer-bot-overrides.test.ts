import { describe, expect, it } from "vitest";
import {
  applyViewerModelOverride,
  crossOwnerSettingsRefusal,
  sharedBotForViewer,
  viewerWantsBotNotification,
} from "./viewer-bot-overrides.ts";
import type { ModelSelection } from "./wire.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";

const selection: ModelSelection = { instanceId: "claude", model: "opus", effort: "high", variant: "think" };

describe("cross-owner model write", () => {
  it("refuses a viewer writing the owner's model or notifications", () => {
    expect(crossOwnerSettingsRefusal({
      organization: true, ownerUserId: BOB, actorId: ADA, writesModel: true, writesNotifications: false,
    })).toBe("model");
    expect(crossOwnerSettingsRefusal({
      organization: true, ownerUserId: BOB, actorId: ADA, writesModel: false, writesNotifications: true,
    })).toBe("notifications");
  });

  it("lets the owner write, and a solo server keeps its record", () => {
    expect(crossOwnerSettingsRefusal({
      organization: true, ownerUserId: BOB, actorId: BOB, writesModel: true, writesNotifications: true,
    })).toBeNull();
    expect(crossOwnerSettingsRefusal({
      organization: false, ownerUserId: BOB, actorId: ADA, writesModel: true, writesNotifications: false,
    })).toBeNull();
    expect(sharedBotForViewer("local-owner", ADA)).toBe(false);
    expect(sharedBotForViewer("", ADA)).toBe(false);
  });
});

describe("viewer turn selection", () => {
  it("uses the override and leaves the bot selection untouched", () => {
    const before = { ...selection };
    const next = applyViewerModelOverride(selection, {
      model: { instanceId: "grok", model: "grok-4" },
      effort: "low",
      updatedAt: 1,
    }, () => true);
    expect(selection).toEqual(before);
    expect(next).toEqual({ instanceId: "grok", model: "grok-4", effort: "low" });
  });

  it("falls back to the bot when the viewer set nothing, and drops an effort the engine does not offer", () => {
    expect(applyViewerModelOverride(selection, undefined, () => true)).toBe(selection);
    expect(applyViewerModelOverride(selection, { updatedAt: 1 }, () => true)).toBe(selection);
    const dropped = applyViewerModelOverride(selection, { effort: "max", updatedAt: 1 }, () => false);
    expect(dropped.effort).toBeUndefined();
    expect(dropped.model).toBe("opus");
    expect(selection.effort).toBe("high");
  });

  it("treats a null effort as the provider default", () => {
    const next = applyViewerModelOverride(selection, { effort: null, updatedAt: 1 }, () => true);
    expect(next.effort).toBeUndefined();
    expect(next.variant).toBe("think");
  });
});

describe("viewer notification choice", () => {
  it("follows the viewer's override and the bot switch otherwise", () => {
    expect(viewerWantsBotNotification({ botNotifications: false, ownerId: BOB, viewerId: ADA, override: true })).toBe(true);
    expect(viewerWantsBotNotification({ botNotifications: true, ownerId: BOB, viewerId: ADA, override: false })).toBe(false);
    expect(viewerWantsBotNotification({ botNotifications: false, ownerId: BOB, viewerId: ADA, override: undefined })).toBe(false);
    expect(viewerWantsBotNotification({ botNotifications: true, ownerId: BOB, viewerId: ADA, override: undefined })).toBe(true);
    expect(viewerWantsBotNotification({ botNotifications: false, ownerId: BOB, viewerId: BOB, override: true })).toBe(false);
  });
});
