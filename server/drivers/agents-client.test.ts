// The agents proxy's token (server/drivers/agents-client.ts): a call's warm
// engine process outlives a turn, so its proxy reads the current turn's
// token from the file the harness rewrites each turn.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { commsToken } from "./agents-client.ts";

describe("the comms token", () => {
  it("is the launch token without a token file", () => {
    expect(commsToken({ SAGAX_COMMS_TOKEN: "launch" })()).toBe("launch");
  });

  it("is read fresh from the token file on every request, the launch token as a fallback", () => {
    const file = join(mkdtempSync(join(tmpdir(), "omb-comms-")), "t.token");
    const token = commsToken({ SAGAX_COMMS_TOKEN: "launch", SAGAX_COMMS_TOKEN_FILE: file });
    expect(token()).toBe("launch");
    writeFileSync(file, "turn-two\n");
    expect(token()).toBe("turn-two");
    writeFileSync(file, "turn-three");
    expect(token()).toBe("turn-three");
  });
});
