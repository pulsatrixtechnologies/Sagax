// A person's own device-code sign-in for Grok Build and Kimi Code
// (organization server): only the provider's own device link and its code
// leave the CLI's output, and signed in means exit 0 plus the CLI's file.
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DEVICE_LOGIN_SPECS, DeviceLoginController, deviceLoginFailure, deviceLoginPrompt } from "./device-login.ts";

const grok = DEVICE_LOGIN_SPECS.grokAgent;
const kimi = DEVICE_LOGIN_SPECS.kimiAgent;

describe("deviceLoginPrompt", () => {
  it("reads grok 1.0.46's device prompt", () => {
    const out = "To sign in, open this URL in your browser:\n\n  https://accounts.x.ai/oauth2/device?user_code=8TAQ-YK9J\n\nConfirm this code in your browser:\n\n  8TAQ-YK9J\n\nWaiting for authorization...\n";
    expect(deviceLoginPrompt(grok, out)).toEqual({ authorizationUrl: "https://accounts.x.ai/oauth2/device?user_code=8TAQ-YK9J", userCode: "8TAQ-YK9J" });
  });

  it("reads kimi-code 2.1.1's device prompt", () => {
    const out = "Opening browser for Kimi device login: https://www.kimi.ai/code/authorize_device?user_code=G45W-1N1J\nIf the browser did not open, paste the URL above and enter code: G45W-1N1J\nCode expires in 1800s.\n";
    expect(deviceLoginPrompt(kimi, out)).toEqual({ authorizationUrl: "https://www.kimi.ai/code/authorize_device?user_code=G45W-1N1J", userCode: "G45W-1N1J" });
  });

  it("never turns another host, extra query or a mismatched code into a link", () => {
    expect(deviceLoginPrompt(grok, "https://evil.example/oauth2/device?user_code=AAAA-BBBB\nAAAA-BBBB\n")).toBeNull();
    expect(deviceLoginPrompt(grok, "https://accounts.x.ai/oauth2/device?user_code=AAAA-BBBB&next=https://evil\nAAAA-BBBB\n")).toBeNull();
    expect(deviceLoginPrompt(grok, "https://accounts.x.ai/oauth2/device?user_code=AAAA-BBBB\nCCCC-DDDD\n")).toBeNull();
    expect(deviceLoginPrompt(kimi, "https://www.kimi.ai/code/authorize_device?user_code=G45W-1N1J")).toBeNull();
  });
});

describe("deviceLoginFailure", () => {
  it("says the server could not reach the sign-in service, without the address or the code", () => {
    const message = deviceLoginFailure(grok, "Error: error sending request for url (https://auth.x.ai/oauth2/device/code): client error (Connect): tcp connect error: Connection refused (os error 111) ABCD-EFGH\n");
    expect(message).toBe("Grok could not reach its sign-in service from this server. Check the server's outbound connection, then try again.");
    expect(message).not.toMatch(/https?:|auth\.x\.ai|ABCD-EFGH/i);
  });

  it("says when this server's CLI does not understand subscription sign-in", () => {
    expect(deviceLoginFailure(kimi, "error: unexpected argument '--device-auth' found\n")).toBe("This server's Kimi CLI needs updating for subscription sign-in.");
  });

  it("keeps a short sanitized reason and drops a device code inside it", () => {
    const message = deviceLoginFailure(grok, "Error: access denied for code ABCD-EFGH\n");
    expect(message).toContain("access denied");
    expect(message).not.toContain("ABCD-EFGH");
  });
});

/** A fake CLI that dies before a code, the way grok exits when auth.x.ai refuses the connection. */
function unreachableCli(): string {
  const dir = mkdtempSync(join(tmpdir(), "device-login-cli-"));
  const path = join(dir, "cli.mjs");
  writeFileSync(path, `#!/usr/bin/env node
process.stderr.write("Error: error sending request for url (https://auth.x.ai/oauth2/device/code): Connection refused (os error 111) ABCD-EFGH\\n");
process.exit(1);
`);
  chmodSync(path, 0o755);
  return path;
}

/** A fake CLI: prints the prompt, then writes the credential file and exits 0. */
function fakeCli(engine: "grokAgent" | "kimiAgent", fail = false): string {
  const dir = mkdtempSync(join(tmpdir(), "device-login-cli-"));
  const path = join(dir, "cli.mjs");
  const file = engine === "grokAgent"
    ? "join(process.env.GROK_HOME || join(process.env.HOME, '.grok'), 'auth.json')"
    : "join(process.env.KIMI_CODE_HOME, 'credentials', 'kimi-code.json')";
  const link = engine === "grokAgent" ? "https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH\\n\\nABCD-EFGH" : "login: https://www.kimi.ai/code/authorize_device?user_code=ABCD-EFGH\\nenter code: ABCD-EFGH";
  writeFileSync(path, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
process.stdout.write("${link}\\n");
setTimeout(() => {
  ${fail ? "process.exit(1);" : `const f = ${file}; mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify({ token: "grok-secret-token" })); process.exit(0);`}
}, 150);
`);
  chmodSync(path, 0o755);
  return path;
}

describe("DeviceLoginController", () => {
  it.each(["grokAgent", "kimiAgent"] as const)("%s: shows the code, then succeeds once the CLI wrote its login in the person's home", async (engine) => {
    const home = mkdtempSync(join(tmpdir(), "device-login-home-"));
    let authenticated = 0;
    const controller = new DeviceLoginController({ engine, cli: fakeCli(engine), home, environment: () => ({ PATH: process.env.PATH }), onAuthenticated: async () => { authenticated += 1; } });
    const started = await controller.start();
    expect(started).toMatchObject({ phase: "waiting", userCode: "ABCD-EFGH" });
    expect(started.authorizationUrl).toContain("user_code=ABCD-EFGH");
    await expect.poll(async () => (await controller.get(started.flowId!)).phase, { timeout: 5000 }).toBe("succeeded");
    expect(authenticated).toBe(1);
    expect(existsSync(DEVICE_LOGIN_SPECS[engine].credentialFile(home))).toBe(true);
    expect(JSON.stringify(await controller.get(started.flowId!))).not.toContain("grok-secret-token");
    // already signed in: no new flow
    expect(await controller.start()).toMatchObject({ phase: "succeeded" });
  });

  it("grok login writes into the person's GROK_HOME, not a server home, and the response has no credential", async () => {
    const home = mkdtempSync(join(tmpdir(), "device-login-home-"));
    const leaked = mkdtempSync(join(tmpdir(), "device-login-leaked-"));
    const controller = new DeviceLoginController({
      engine: "grokAgent",
      cli: fakeCli("grokAgent"),
      home,
      environment: () => ({ PATH: process.env.PATH, HOME: "/server", GROK_HOME: leaked }),
    });
    expect(grok.homeEnv(home)).toEqual({ HOME: home, GROK_HOME: join(home, ".grok") });
    const started = await controller.start();
    expect(JSON.stringify(started)).not.toContain("grok-secret-token");
    expect(started.authorizationUrl).toBe("https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH");
    await expect.poll(async () => (await controller.get(started.flowId!)).phase, { timeout: 5000 }).toBe("succeeded");
    const status = await controller.get(started.flowId!);
    expect(JSON.stringify(status)).not.toContain("grok-secret-token");
    expect(existsSync(join(home, ".grok", "auth.json"))).toBe(true);
    expect(existsSync(join(leaked, "auth.json"))).toBe(false);
  });

  it("a CLI that exits without a login fails the flow", async () => {
    const home = mkdtempSync(join(tmpdir(), "device-login-home-"));
    const controller = new DeviceLoginController({ engine: "grokAgent", cli: fakeCli("grokAgent", true), home, environment: () => ({ PATH: process.env.PATH }) });
    const started = await controller.start();
    await expect.poll(async () => (await controller.get(started.flowId!)).phase, { timeout: 5000 }).toBe("failed");
  });

  it("a CLI that cannot reach the sign-in service rejects start without the address or the code", async () => {
    const home = mkdtempSync(join(tmpdir(), "device-login-home-"));
    const controller = new DeviceLoginController({ engine: "grokAgent", cli: unreachableCli(), home, environment: () => ({ PATH: process.env.PATH }) });
    await expect(controller.start()).rejects.toThrow("Grok could not reach its sign-in service from this server. Check the server's outbound connection, then try again.");
  });

  it("cancel ends a waiting flow", async () => {
    const home = mkdtempSync(join(tmpdir(), "device-login-home-"));
    const controller = new DeviceLoginController({ engine: "kimiAgent", cli: fakeCli("kimiAgent"), home, environment: () => ({ PATH: process.env.PATH }) });
    const started = await controller.start();
    await controller.cancel();
    expect((await controller.get(started.flowId!)).phase).toBe("cancelled");
  });
});
