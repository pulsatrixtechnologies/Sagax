// SentinelOne guest scripts and install, with a fake exec. No package is
// downloaded and SentinelOne is never contacted.
import assert from "node:assert/strict";
import test from "node:test";

import {
  S1_POLICY,
  S1_SITE,
  TOKEN_LEFT_ERROR,
  commandGuestTransport,
  guestExecArgv,
  guestScripts,
  installScript,
  probeScript,
  runSentinelOneInstall,
  writeScript,
} from "./sentinelone-vm.mjs";

const TOKEN = "s1-site-token-DO-NOT-LEAK-9f3a";
const SYSTEMS = ["linux-deb", "linux-rpm", "windows", "macos"];

test("site and policy are the Pulsatrix detect-only site", () => {
  assert.equal(S1_SITE, "Pulsatrix Technologies Inc.");
  assert.equal(S1_POLICY, "detect-only");
});

test("install scripts name no token and no network address", () => {
  for (const os of SYSTEMS) {
    const scripts = guestScripts(os);
    for (const script of [scripts.write, scripts.wipe, scripts.env, scripts.probe, scripts.install]) {
      assert.equal(script.includes(TOKEN), false);
      assert.equal(/https?:\/\//.test(script), false);
    }
    const argv = guestExecArgv({ runtime: "docker", container: "box", os, script: scripts.probe, token: TOKEN });
    assert.equal(argv.join("\n").includes(TOKEN), false);
  }
  assert.equal(probeScript("windows").includes("C:\\Program Files\\SentinelOne"), true);
  assert.equal(probeScript("windows").includes("C:\\\\Program"), false);
  assert.equal(installScript("linux-rpm").includes("rpm -U"), true);
  assert.equal(installScript("linux-deb").includes("dpkg -i"), true);
  assert.equal(installScript("macos").includes("installer -pkg"), true);
  assert.equal(writeScript("linux-deb").includes("/run/sagax-s1.token"), true);
});

test("the token is stdin of the write step only, then the file is removed", async () => {
  const calls = [];
  let probes = 0;
  const transport = commandGuestTransport({
    os: "linux-deb",
    token: TOKEN,
    container: "box",
    runtime: "docker",
    exec: async (call) => {
      calls.push(call);
      if (call.kind === "env") return { code: 0, stdout: "PATH=/usr/bin" };
      if (call.kind === "write" || call.kind === "wipe") return { code: 0 };
      if (call.script.includes("dpkg")) return { code: 0, stdout: "installed" };
      probes += 1;
      return probes === 1 ? { code: 1, stdout: "not registered" } : { code: 0, stdout: "Agent is online" };
    },
  });
  const result = await runSentinelOneInstall({ transport, token: TOKEN, os: "linux-deb" });
  assert.equal(result.state, "active");
  assert.equal(result.audited, true);
  const write = calls.filter((call) => call.kind === "write");
  assert.equal(write.length, 1);
  assert.equal(write[0].stdin, TOKEN);
  assert.equal(calls.some((call) => call.kind === "wipe"), true);
  assert.equal(calls.some((call) => call.argv.join("\n").includes(TOKEN) || call.script.includes(TOKEN)), false);
  assert.equal(JSON.stringify({ state: result.state, error: result.error, code: result.code }).includes(TOKEN), false);
});

test("a token left in the guest fails without repeating it, and wipe still runs", async () => {
  const calls = [];
  const transport = commandGuestTransport({
    os: "macos",
    token: TOKEN,
    container: "box",
    runtime: "docker",
    exec: async (call) => {
      calls.push(call);
      if (call.kind === "wipe" || call.kind === "write") return { code: 0 };
      if (call.kind === "env") return { code: 0, stdout: TOKEN };
      if (call.script.includes("installer")) return { code: 0, stdout: `pkg ${TOKEN}` };
      return { code: 1, stdout: "not registered" };
    },
  });
  const result = await runSentinelOneInstall({ transport, token: TOKEN, os: "macos" });
  assert.equal(result.state, "failed");
  assert.equal(result.code, "token_left");
  assert.equal(result.error, TOKEN_LEFT_ERROR);
  assert.equal(String(result.error).includes(TOKEN), false);
  assert.equal(calls.some((call) => call.kind === "wipe"), true);
});

test("an installer error is redacted and the token file is still removed", async () => {
  const kinds = [];
  const transport = commandGuestTransport({
    os: "windows",
    token: TOKEN,
    container: "box",
    runtime: "docker",
    exec: async (call) => {
      kinds.push(call.kind);
      if (call.kind === "wipe") return { code: 0 };
      if (call.kind === "write") return { code: 0 };
      if (call.script.includes("msiexec")) return { code: 1, stderr: `msiexec ${TOKEN}` };
      return { code: 1, stdout: "not registered" };
    },
  });
  const result = await runSentinelOneInstall({ transport, token: TOKEN, os: "windows" });
  assert.equal(result.state, "failed");
  assert.equal(String(result.error).includes(TOKEN), false);
  assert.equal(String(result.error).includes("[hidden]"), true);
  assert.equal(kinds.includes("wipe"), true);
  assert.equal(kinds.includes("write"), true);
});

test("an ephemeral-style skip is the caller's: a missing package fails closed", async () => {
  const transport = commandGuestTransport({
    os: "linux-deb",
    token: TOKEN,
    container: "box",
    runtime: "docker",
    exec: async (call) => {
      if (call.kind === "wipe" || call.kind === "write") return { code: 0 };
      if (call.script.includes("dpkg")) return { code: 3, stderr: "The SentinelOne package for this system is not configured." };
      return { code: 1, stdout: "not registered" };
    },
  });
  const result = await runSentinelOneInstall({ transport, token: TOKEN, os: "linux-deb" });
  assert.equal(result.code, "package_missing");
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});
