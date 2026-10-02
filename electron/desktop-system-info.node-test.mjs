// The coarse system facts the desktop app sends for the person's Computer
// tab (electron/desktop-bridge.mjs systemInfo): rounded, bounded, and nothing
// about files, apps or networks.
import test from "node:test";
import assert from "node:assert/strict";

import { systemInfo } from "./desktop-bridge.mjs";

test("system info is coarse and carries only OS, CPU, memory and disk", async () => {
  const first = await systemInfo({ platform: "darwin", version: "27.0.1", statfs: async () => ({ blocks: 1_000_000, bsize: 4096, bavail: 250_000 }) });
  const { info } = await systemInfo({ platform: "darwin", version: "27.0.1", previous: first.sample, statfs: async () => ({ blocks: 1_000_000, bsize: 4096, bavail: 250_000 }) });
  const allowed = new Set(["arch", "cpuModel", "cpuPercent", "cpus", "diskFreeGb", "diskGb", "memoryGb", "memoryUsedGb", "os"]);
  for (const key of Object.keys(info)) assert.ok(allowed.has(key), key);
  assert.equal(info.os, "macOS 27.0.1");
  assert.equal(info.diskGb, 4);
  assert.equal(info.diskFreeGb, 1);
  assert.equal(info.memoryGb % 0.5, 0);
  assert.ok(info.cpus >= 1);
  if (info.cpuPercent !== undefined) assert.equal(info.cpuPercent % 5, 0);
  assert.ok(info.os.length <= 80 && info.arch.length <= 20);
});

test("an unreadable disk leaves the disk out", async () => {
  const { info } = await systemInfo({ platform: "win32", version: "10.0.26100", statfs: async () => { throw new Error("no"); } });
  assert.equal(info.os, "Windows 10.0.26100");
  assert.equal(info.diskGb, undefined);
});
