// Cursor signs in from the app by running `cursor-agent login` on the
// machine that runs the engine. The fake CLI below is the whole process:
// no real Cursor, no call to cursor.com, nobody's credentials.
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeTempDir } from "../testing/cleanup.ts";
import { LinkSignInController } from "./link-sign-in.ts";

const PAGE = "https://cursor.com/loginDeepControl?challenge=abc&uuid=def&mode=login";

function fakeCli(home: string): string {
  const path = join(home, "fake-cursor-agent");
  writeFileSync(path, `#!/usr/bin/env node
const fs = require("node:fs");
const mode = process.env.FAKE_CURSOR_MODE;
if (mode === "evil") {
  console.log("https://evil.example/login?token=sk-supersecretvalue1234567890");
  process.exit(1);
}
if (mode === "network") {
  console.error("connection refused while reaching the sign-in service");
  process.exit(1);
}
process.stdout.write(${JSON.stringify(PAGE)});
const deadline = Date.now() + 8000;
const timer = setInterval(() => {
  if (fs.existsSync(process.env.HOME + "/signed-in")) { clearInterval(timer); process.exit(0); }
  if (Date.now() > deadline) process.exit(1);
}, 40);
`);
  chmodSync(path, 0o755);
  return path;
}

describe.skipIf(process.platform === "win32")("Cursor sign-in by opening a page", () => {
  let home: string;
  const controllers: LinkSignInController[] = [];
  afterEach(async () => {
    await Promise.all(controllers.splice(0).map((controller) => controller.dispose()));
    if (home) await removeTempDir(home);
  });

  function start(mode: string) {
    home = mkdtempSync(join(tmpdir(), "omb-cursor-link-"));
    const cli = fakeCli(home);
    const controller = new LinkSignInController({
      product: "Cursor",
      account: "Cursor",
      homeEnv: "CURSOR_CONFIG_DIR",
      homeDir: ".cursor",
      loginArgs: ["login"],
      install: "Install Cursor, then try again.",
      spawnEnv: { NO_OPEN_BROWSER: "1", BROWSER: "none" },
      signedIn: (env) => existsSync(join(env.HOME ?? "", "signed-in")),
    }, {
      cli,
      environment: () => ({ HOME: home, USERPROFILE: home, PATH: process.env.PATH, FAKE_CURSOR_MODE: mode }),
      pollMs: 50,
      startupTimeoutMs: 4_000,
    });
    controllers.push(controller);
    return controller;
  }

  it("returns Cursor's page, then confirms the sign-in the driver's own check reads", async () => {
    const controller = start("ok");
    const started = await controller.start();
    expect(started).toMatchObject({ phase: "waiting", authorizationUrl: PAGE, flowId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(started.userCode).toBeUndefined();
    writeFileSync(join(home, "signed-in"), "1");
    await expect.poll(() => controller.get(started.flowId!), { timeout: 5_000 }).toMatchObject({ phase: "succeeded", authorizationUrl: null });
  });

  it("refuses a page that is not Cursor's, and never echoes a token", async () => {
    const controller = start("evil");
    const error = await controller.start().then(() => null, (cause: unknown) => cause);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toMatch(/did not finish|unexpected sign-in response|sign-in page/);
    expect(message).not.toContain("sk-supersecret");
    expect(message).not.toContain("evil.example");
  });

  it("says when the sign-in service cannot be reached, without the CLI's words", async () => {
    const controller = start("network");
    await expect(controller.start()).rejects.toThrow(/could not reach its sign-in service/);
  });
});
