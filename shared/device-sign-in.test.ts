import { describe, expect, it } from "vitest";
import { deviceSignInPrompt } from "./device-sign-in.ts";

const KIMI = "https://www.kimi.ai/code/authorize_device?user_code=ABCD-EF12";

describe("device sign-in prompt", () => {
  it("reads a Kimi page in the middle of a line and the code stated after it", () => {
    const text = [
      "Open this page and enter the code.",
      `Visit ${KIMI} now`,
      "enter code: ABCD-EF12",
      "",
    ].join("\n");
    expect(deviceSignInPrompt("kimi", text)).toEqual({ authorizationUrl: KIMI, userCode: "ABCD-EF12" });
  });

  it("uses the code carried in the Kimi link when none is stated", () => {
    expect(deviceSignInPrompt("kimi", `${KIMI}\n`)).toEqual({ authorizationUrl: KIMI, userCode: "ABCD-EF12" });
  });

  it("refuses a Grok page whose stated code disagrees with the link", () => {
    const text = "https://accounts.x.ai/oauth2/device?user_code=ZZZZ-ZZZZ\nWDJB-MJHT\n";
    expect(deviceSignInPrompt("grok", text)).toBeNull();
  });

  it("does not treat a half-printed last line as a code", () => {
    expect(deviceSignInPrompt("grok", "https://accounts.x.ai/oauth2/device\nWDJB-MJ")).toBeNull();
  });
});
