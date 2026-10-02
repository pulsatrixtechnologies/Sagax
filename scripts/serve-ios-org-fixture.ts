// An isolated organization server for the iOS "Sign in with Pulsatrix" checks:
// the fake Perspicax (server/testing/fake-oidc-provider.ts) signs one person
// in at once, and a real server with a temporary home serves the phone.
// Prints the server origin and runs until killed. Never touches ~/.sagax.
//
//   node --experimental-strip-types scripts/serve-ios-org-fixture.ts [--port N]
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider } from "../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESERVED = [18790, 5199, 8799];
const portArg = process.argv.indexOf("--port");
const idp = await startFakeOidcProvider({ user: { sub: "01J9IOSORGFIXTURE00000000", email: "sam.rivera@example.test", name: "Sam Rivera", preferred_username: "sam", role: "employee" } });
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : await freePortBlock([0, 1]);
if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
const origin = `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), "sagax-ios-org-"));
mkdirSync(join(home, ".sagax"), { recursive: true });
writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({ instances: { grok: { driver: "grokAgent", config: { cli: join(ROOT, "server", "testing", "fake-acp-cli.ts"), fullAuto: false } } } }));
const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
    SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: origin,
  },
  stdio: ["ignore", "inherit", "inherit"],
});
const deadline = Date.now() + 30_000;
for (;;) {
  try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not yet */ }
  if (Date.now() > deadline) throw new Error("server never came up");
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`[ios-org-fixture] server ${origin} issuer ${idp.issuer} home ${home}`);
const stop = () => { server.kill("SIGTERM"); void idp.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => { console.log(`[ios-org-fixture] server exited ${code}`); process.exit(code ?? 1); });
