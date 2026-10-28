import { describe, expect, it } from "vitest";

import { xSocialUnavailable } from "./x-social.ts";

describe("x social", () => {
  it("refuses messages and spaces, and never reports a send", () => {
    expect(xSocialUnavailable("messages")).toEqual({ ok: false, code: "no_x_connector", missing: "messages" });
    expect(xSocialUnavailable("spaces")).toEqual({ ok: false, code: "no_x_connector", missing: "spaces" });
    expect(xSocialUnavailable("messages").ok).toBe(false);
  });
});
