import { describe, expect, it } from "vitest";

import { DEVICE_TOKEN, PUSH_TOKEN_HEADER, pushTokenFromHeader, tokensOfConnectedDevices } from "./devices.ts";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

describe("push token on a live stream", () => {
  it("accepts a hex APNs token from the header and ignores junk", () => {
    expect(PUSH_TOKEN_HEADER).toBe("x-sagax-push-token");
    expect(pushTokenFromHeader(TOKEN_A)).toBe(TOKEN_A);
    expect(pushTokenFromHeader(TOKEN_A.toUpperCase())).toBe(TOKEN_A);
    expect(pushTokenFromHeader(`  ${TOKEN_A}  `)).toBe(TOKEN_A);
    expect(pushTokenFromHeader([TOKEN_A])).toBe(TOKEN_A);
    expect(pushTokenFromHeader("not-a-token")).toBeUndefined();
    expect(pushTokenFromHeader("")).toBeUndefined();
    expect(pushTokenFromHeader(undefined)).toBeUndefined();
    expect(DEVICE_TOKEN.test(TOKEN_A)).toBe(true);
  });

  it("lists the tokens of this person's connected devices, not another person's", () => {
    const streams = [
      { viewerId: "pr_bob", pushToken: TOKEN_A },
      { viewerId: "PR_BOB", pushToken: TOKEN_B },
      { viewerId: "pr_cara", pushToken: "c".repeat(64) },
      { viewerId: "pr_bob" },
    ];
    expect(tokensOfConnectedDevices(streams, "pr_bob")).toEqual([TOKEN_A, TOKEN_B]);
    expect(tokensOfConnectedDevices(streams, "pr_cara")).toEqual(["c".repeat(64)]);
    expect(tokensOfConnectedDevices(streams, "pr_nobody")).toEqual([]);
  });

  it("on a personal server, a stream without viewerId is the operator", () => {
    expect(tokensOfConnectedDevices([{ pushToken: TOKEN_A }], "pr_owner", "pr_owner")).toEqual([TOKEN_A]);
    expect(tokensOfConnectedDevices([{ pushToken: TOKEN_A }], "pr_owner", "pr_other")).toEqual([]);
  });
});
