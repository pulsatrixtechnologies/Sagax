import { describe, expect, it } from "vitest";
import { cursorSignInLink, cursorSignInPrompt, stripSignInSecrets } from "./cli-sign-in.ts";

const PAGE = "https://cursor.com/loginDeepControl?challenge=abc&uuid=def&mode=login";

describe("Cursor sign-in link", () => {
  it("accepts Cursor's own login pages, including a URL that has not been newline-terminated", () => {
    expect(cursorSignInPrompt(`Open this page:\n${PAGE}`)).toEqual({ authorizationUrl: PAGE });
    expect(cursorSignInPrompt(PAGE)).toEqual({ authorizationUrl: PAGE });
    expect(cursorSignInLink("https://www.cursor.com/login")).toBe("https://www.cursor.com/login");
    expect(cursorSignInLink("https://authenticator.cursor.sh/loginDeepPage?state=ok")).toBe("https://authenticator.cursor.sh/loginDeepPage?state=ok");
  });

  it.each([
    "http://cursor.com/login",
    "https://cursor.com.evil.test/login",
    "https://evilcursor.com/login",
    "https://user@cursor.com/login",
    "https://cursor.com:8443/login",
    "https://cursor.com/login#token",
    "https://cursor.com/login?token=secret-token",
    "https://cursor.com/settings",
    "https://auth.openai.com/codex/device",
  ])("never turns another page into a sign-in link: %s", (page) => {
    expect(cursorSignInLink(page)).toBeNull();
    expect(cursorSignInPrompt(`please open ${page}\n`)).toBeNull();
  });

  it("strips secrets out of failure text", () => {
    const clean = stripSignInSecrets(`failed ${PAGE} code ABCD-EFGH token sk-supersecretvalue1234567890`);
    expect(clean).not.toContain("cursor.com");
    expect(clean).not.toContain("ABCD-EFGH");
    expect(clean).not.toContain("sk-supersecret");
  });
});
