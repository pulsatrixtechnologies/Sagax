import { describe, expect, it } from "vitest";

import { iconUnreadDotPosition } from "./bot-unread";

describe("iconUnreadDotPosition", () => {
  it("moves the unread dot off the corner an avatar badge covers (#1057)", () => {
    expect(iconUnreadDotPosition(false)).toContain("bottom-1.5");
    expect(iconUnreadDotPosition(true)).toContain("top-1.5");
    expect(iconUnreadDotPosition(true)).not.toContain("bottom");
  });
});
