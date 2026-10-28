import { describe, expect, it } from "vitest";
import { usageEvent, usageProps } from "./usage-meter.ts";

describe("usageEvent", () => {
  it("keeps a closed event and drops anything else", () => {
    expect(usageEvent("app_opened", { surface: "desktop" })).toEqual({ name: "app_opened", props: { surface: "desktop" } });
    expect(usageEvent("message_sent", { queued: false })).toEqual({ name: "message_sent", props: { queued: "false" } });
    expect(usageEvent("bot_created", {})).toEqual({ name: "bot_created", props: {} });
    expect(usageEvent("settings_opened", { section: "models" })).toEqual({ name: "settings_opened", props: { section: "models" } });
  });

  it("refuses a name, a property or free text that is not in the schema", () => {
    expect(usageEvent("page_view", {})).toBeNull();
    expect(usageEvent("app_opened", { surface: "phone" })).toBeNull();
    expect(usageEvent("bot_created", { name: "Ada" })).toBeNull();
    expect(usageEvent("message_sent", { queued: false, driver: "some-engine", email: "a@b.c" })).toBeNull();
    expect(usageEvent("settings_opened", { section: "account", note: "hello" })).toBeNull();
    expect(usageEvent("message_sent", usageProps("message_sent", { queued: true, driver: "some-engine" }))).toEqual({
      name: "message_sent", props: { queued: "true" },
    });
  });
});
