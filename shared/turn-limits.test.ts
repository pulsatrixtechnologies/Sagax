import { describe, expect, it } from "vitest";

import { botTurnLimit, DEFAULT_TURN_LIMITS, MAX_TURN_LIMIT } from "./turn-limits.ts";

describe("#1098: a bot's per-turn limits", () => {
  it("keeps 3 room posts, 5 threads and 4 rooms until the owner sets their own", () => {
    expect(DEFAULT_TURN_LIMITS).toEqual({ roomPosts: 3, threadsOpened: 5, roomsCreated: 4 });
    expect(botTurnLimit(undefined, "roomPosts")).toBe(3);
    expect(botTurnLimit({ turnLimits: { threadsOpened: 12 } }, "threadsOpened")).toBe(12);
    expect(botTurnLimit({ turnLimits: { threadsOpened: 12 } }, "roomsCreated")).toBe(4);
    // a stored value out of bounds reads as the default, never as no limit
    expect(botTurnLimit({ turnLimits: { roomPosts: MAX_TURN_LIMIT + 1 } }, "roomPosts")).toBe(3);
  });
});
