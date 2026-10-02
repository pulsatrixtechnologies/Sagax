// The Sagax side of the per-person environment: one key per person shared by
// all their bots, stop and delayed delete when Perspicax signs them out,
// cancel when they come back, and pending deletions that survive a restart.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SandboxService } from "./sandboxd-core.ts";
import { FakeDocker } from "./testing/fake-docker.ts";
import { inProcessSandboxdClient } from "./testing/in-process-sandboxd.ts";
import type { SandboxdClient } from "./user-sandbox-client.ts";
import { UserSandboxManager, userSandboxSettingsFromEnv } from "./user-sandbox-manager.ts";
import { sandboxNames, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const ALICE = "pr_00000000-0000-4000-8000-00000000000a";
const BOB = "pr_00000000-0000-4000-8000-00000000000b";
const HOUR = 3600_000;

let dir: string;
let now: number;
let docker: FakeDocker;
let service: SandboxService;

/** The real provisioner logic behind an in-process client. */
function inProcessClient(): SandboxdClient {
  return inProcessSandboxdClient(service);
}

function manager(graceMs = 72 * HOUR) {
  return new UserSandboxManager({ client: inProcessClient(), instance: "default", stateFile: join(dir, "deletions.json"), graceMs, now: () => now });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "user-sandbox-"));
  now = 1_000_000;
  docker = new FakeDocker();
  docker.now = () => now;
  service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" }), () => now);
  await service.installEgressPolicy();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("UserSandboxManager", () => {
  it("is lazy: a person's status is missing until a tool needs it", async () => {
    const m = manager();
    expect((await m.status(ALICE)).state).toBe("missing");
    expect(docker.containers.size).toBe(0);
    await m.exec(ALICE, { argv: ["true"] });
    expect((await m.status(ALICE)).state).toBe("running");
  });

  it("uses one environment per person for all their bots, and separate ones per person", async () => {
    const m = manager();
    // Three bots of Alice and one of Bob: the key is the person's, not the bot's.
    for (let bot = 0; bot < 3; bot++) await m.exec(ALICE, { argv: ["true"] });
    await m.exec(BOB, { argv: ["true"] });
    expect(docker.containers.size).toBe(2);
    expect(docker.containers.has(sandboxNames(m.keyFor(ALICE)).container)).toBe(true);
    expect(m.keyFor(ALICE)).not.toBe(m.keyFor(BOB));
  });

  it("stops at once and deletes after the grace period when a person is signed out", async () => {
    const m = manager(72 * HOUR);
    await m.exec(ALICE, { argv: ["true"] });
    await m.personOut(ALICE);
    expect((await m.status(ALICE)).state).toBe("stopped");
    expect(m.pendingDeletionAt(ALICE)).toBe(now + 72 * HOUR);
    await expect(m.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "person_out" });
    now += 71 * HOUR;
    expect(await m.sweepDeletions()).toEqual([]);
    now += 2 * HOUR;
    expect(await m.sweepDeletions()).toEqual([ALICE]);
    expect(docker.containers.size).toBe(0);
    expect(docker.volumes.size).toBe(0);
    expect(m.pendingDeletionAt(ALICE)).toBeNull();
  });

  it("keeps the environment when the person is back before the grace ends", async () => {
    const m = manager();
    await m.exec(ALICE, { argv: ["true"] });
    await m.personOut(ALICE);
    m.personBack(ALICE);
    now += 100 * HOUR;
    expect(await m.sweepDeletions()).toEqual([]);
    expect(docker.volumes.has(sandboxNames(m.keyFor(ALICE)).volume)).toBe(true);
    await m.exec(ALICE, { argv: ["true"] });
  });

  it("remembers pending deletions across a restart", async () => {
    await manager().personOut(BOB);
    const restarted = manager();
    expect(restarted.pendingDeletionAt(BOB)).toBe(now + 72 * HOUR);
  });

  it("reset recreates the environment from scratch", async () => {
    const m = manager();
    await m.exec(ALICE, { argv: ["true"] });
    const creates = docker.calls.filter((call) => call.startsWith("create")).length;
    const view = await m.reset(ALICE);
    expect(view.state).toBe("running");
    expect(docker.calls).toContain(`rmvol ${sandboxNames(m.keyFor(ALICE)).volume}`);
    expect(docker.calls.filter((call) => call.startsWith("create")).length).toBe(creates + 1);
  });

  it("reports unavailable instead of throwing when the provisioner is down", async () => {
    const down: SandboxdClient = {
      info: () => Promise.reject(new Error("down")), status: () => Promise.reject(new Error("down")),
      ensure: () => Promise.reject(new Error("down")), stop: () => Promise.reject(new Error("down")),
      remove: () => Promise.reject(new Error("down")), exec: () => Promise.reject(new Error("down")),
      desktopStream: () => Promise.reject(new Error("down")), pause: () => Promise.reject(new Error("down")),
      resume: () => Promise.reject(new Error("down")), stats: () => Promise.reject(new Error("down")),
    };
    const m = new UserSandboxManager({ client: down, instance: "default", stateFile: join(dir, "x.json") });
    expect((await m.status(ALICE)).state).toBe("unavailable");
    await expect(m.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "unreachable" });
  });

  it("is configured only with a provisioner URL", () => {
    expect(userSandboxSettingsFromEnv({})).toBeNull();
    expect(userSandboxSettingsFromEnv({ SAGAX_SANDBOXD_URL: "http://sagax-sandboxd:8791", SAGAX_SANDBOX_DELETE_GRACE_HOURS: "24" }))
      .toMatchObject({ url: "http://sagax-sandboxd:8791", graceMs: 24 * HOUR, instance: "default" });
    expect(() => userSandboxSettingsFromEnv({ SAGAX_SANDBOXD_URL: "http://x:1", SAGAX_SANDBOX_DELETE_GRACE_HOURS: "-1" })).toThrow();
  });
});
