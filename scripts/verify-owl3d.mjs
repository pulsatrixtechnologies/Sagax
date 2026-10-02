// Real-Electron check of the 3D desktop mascot (tools/owl3d): screenshots of the
// owl facing both ways, walking, flying, turning, in a few colors and skins, and
// of the real floating bot window with a bot set to the 3D owl.
// Isolated: its own Vite server on a free port, a temporary Electron profile and
// data folder; it starts no Sagax server and touches no running app.
//
//   node scripts/verify-owl3d.mjs [output folder]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESERVED = new Set([18790, 5199, 8799]);
const out = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "owl3d-shots-")));
mkdirSync(out, { recursive: true });

const freePort = () =>
  new Promise((done) => {
    const probe = netServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
let port = await freePort();
while (RESERVED.has(port)) port = await freePort();

const vite = await createServer({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), server: { port, strictPort: true, host: "127.0.0.1", open: false }, logLevel: "warn" });
await vite.listen();
const origin = `http://127.0.0.1:${port}`;
const profile = mkdtempSync(join(tmpdir(), "owl3d-electron-"));
const electron = createRequire(import.meta.url)("electron");
const code = await new Promise((done) => {
  const child = spawn(electron, [join(ROOT, "scripts", "verify-owl3d.electron.cjs"), `--user-data-dir=${profile}`], {
    env: { ...process.env, VERIFY_ORIGIN: origin, VERIFY_OUT: out, SAGAX_DATA_DIR: join(profile, "data") },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (status) => done(status ?? 1));
});
await vite.close();
// captures carry the display's color profile (Display P3 on a Mac): saved as sRGB, they show the palette's true values
if (process.platform === "darwin") {
  const { readdirSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  for (const file of readdirSync(out).filter((name) => name.endsWith(".png"))) {
    execFileSync("sips", ["-m", "/System/Library/ColorSync/Profiles/sRGB Profile.icc", join(out, file), "--out", join(out, file)], { stdio: "ignore" });
  }
}
console.log(`[verify-owl3d] screenshots in ${out}`);
process.exit(code);
