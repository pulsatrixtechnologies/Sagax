// Real-Electron check of voice mode in server mode: the desktop draws its
// own bundled UI on an organization server's origin, signs in, opens the
// voice bar on a bot, hears a turn through the microphone (Chromium's fake
// capture device, fed a WAV of a tone then silence), sends it to the
// server, which transcribes it with "xAI" (a loopback fake), and the words
// reach the bot's thread as the signed-in person. The settings panel's
// Voice, Speed and Language go to xAI's speech request and to the person's
// server preferences. First without any xAI key: the call button shows the
// speaker's access card (never the legacy "This computer" gate); then the
// admin adds the organization's key (Settings > Connections) and the same
// button opens the bar. The key (a fake) must never reach the page.
// Isolated: temporary home and Electron profile, free ports.
//
//   pnpm exec vite build
//   node --experimental-strip-types scripts/verify-voice-mode.ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOidcProvider } from "../server/testing/fake-oidc-provider.ts";
import { startFakeXaiVoice } from "../server/testing/fake-xai-voice.ts";
import { freePortBlock } from "../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const electron = createRequire(import.meta.url)("electron") as unknown as string;
const RESERVED = [18790, 5199, 8799];
// fake: long and distinct so any fragment of it would be caught
const FAKE_KEY = "xai-VERIFYfakeKq7Zp2Lw9Rt4Mn6Bv";

const idp = await startFakeOidcProvider({ user: { sub: "01J9VERIFYVOICEMODE0000000", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "admin" } });
const xai = await startFakeXaiVoice({ transcript: "Hello Cryptic from voice mode" });
const port = await freePortBlock([0, 1]);
if (RESERVED.includes(port) || RESERVED.includes(port + 1)) throw new Error("reserved port, run again");
const origin = `http://127.0.0.1:${port}`;
const home = mkdtempSync(join(tmpdir(), "omb-verify-voice-"));
mkdirSync(join(home, ".openmausbot"), { recursive: true });
writeFileSync(join(home, ".openmausbot", "config.json"), "{}");
const decoy = mkdtempSync(join(tmpdir(), "omb-verify-voice-decoy-"));
writeFileSync(join(decoy, "index.html"), "<!doctype html><title>SERVER IMAGE UI</title>");

// What the microphone hears: 1.2 s of a 220 Hz tone, then 2.5 s of silence (looped by Chromium).
const rate = 16_000;
const samples = new Int16Array(Math.round(rate * 3.7));
for (let i = 0; i < rate * 1.2; i++) samples[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.5 * 0x7fff);
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples.length * 2, 4); wav.write("WAVE", 8); wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < samples.length; i++) wav.writeInt16LE(samples[i]!, 44 + i * 2);
const micFile = join(home, "mic.wav");
writeFileSync(micFile, wav);

let serverLog = "";
const server: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1),
    OMB_STATIC_DIR: decoy, OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: idp.issuer, OMB_PUBLIC_URL: origin,
    // the fake xAI; the organization's key is added in Settings > Connections during the run
    OMB_XAI_TTS_API: `${xai.url}/v1`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout!.on("data", (c) => (serverLog += c));
server.stderr!.on("data", (c) => (serverLog += c));
const deadline = Date.now() + 30_000;
for (;;) {
  try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not yet */ }
  if (Date.now() > deadline) throw new Error(`server never came up:\n${serverLog}`);
  await new Promise((r) => setTimeout(r, 200));
}
console.log(`[verify] organization server ${origin}, fake xAI ${xai.url}`);

const userData = mkdtempSync(join(tmpdir(), "omb-verify-voice-ud-"));
const code = await new Promise<number>((resolve) => {
  const child = spawn(electron, [join(ROOT, "scripts", "verify-voice-mode.electron.mjs"), `--user-data-dir=${userData}`], {
    env: { ...process.env, VERIFY_ORIGIN: origin, VERIFY_BUNDLE: join(ROOT, "dist"), VERIFY_XAI: xai.url, VERIFY_FAKE_KEY: FAKE_KEY, VERIFY_MIC_FILE: micFile },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (status) => resolve(status ?? 1));
});
server.kill("SIGTERM");
await idp.close();
await xai.close();
if (serverLog.includes(FAKE_KEY.slice(8, 20))) {
  console.log("[verify] FAIL: the xAI key reached the server log");
  process.exit(1);
}
process.exit(code);
