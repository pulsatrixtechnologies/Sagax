import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { productionEngineIds } from "./engine-image-gate.mjs";
import {
  CADDY_RECREATE_ARGV,
  CADDY_RECREATE_COMMAND,
  PREV_FILE,
  alertsFromLog,
  assertNotKept,
  deployImage,
  formatAlert,
  imagesToPrune,
} from "./gox-deploy.mjs";

const lock = JSON.parse(readFileSync(join(import.meta.dirname, "..", "engines.lock.json"), "utf8"));
const required = productionEngineIds(lock);
const candidate = "pulsa-bot-server:main-20004735";
const previous = "pulsa-bot-server:main-167d8e13";

function fullManifest() {
  return {
    engineSet: "all",
    installed: required.map((id) => ({ id, bin: id === "cursor" ? "cursor-agent" : id })),
  };
}

function startupLog() {
  return [
    ...required.map((id) => `[engines] ${id}: 1 (pinned 1, /usr/local/bin/${id})`),
    `[engines] self-check: ${required.length}/${required.length} preinstalled engine(s) start (image set all)`,
  ].join("\n");
}

function io(overrides = {}) {
  const calls = [];
  const state = { previous: overrides.previous ?? "", running: overrides.running ?? previous };
  return {
    calls,
    state,
    async readManifest() {
      calls.push("manifest");
      return overrides.manifest ?? fullManifest();
    },
    async runningImage() {
      return state.running;
    },
    async readPrevious() {
      return state.previous;
    },
    async writePrevious(ref) {
      calls.push(["writePrevious", ref]);
      state.previous = ref;
    },
    async deploy(image) {
      calls.push(["deploy", image]);
      state.running = image;
    },
    async smoke() {
      calls.push("smoke");
      return overrides.smoke ?? { ok: true, healthz: '{"ok":true,"app":"openmausbot"}', log: startupLog(), imageId: "sha256:running" };
    },
    async recreateCaddy() {
      calls.push(["caddy", [...CADDY_RECREATE_ARGV]]);
    },
    async listImages() {
      return overrides.images ?? [];
    },
    async prune(images) {
      calls.push(["prune", images.map((image) => image.ref || image.id)]);
    },
    async alert(lines) {
      calls.push(["alert", lines]);
    },
  };
}

describe("deployImage", () => {
  it("refuses engineSet none before switching and alerts", async () => {
    const fake = io({ manifest: { engineSet: "none", installed: [] } });
    const result = await deployImage({ image: candidate, lock }, fake);
    expect(result).toMatchObject({ ok: false, code: 1, refused: true });
    expect(result.errors[0]).toBe("engineSet is none");
    expect(fake.calls.some((call) => call === "smoke" || (Array.isArray(call) && call[0] === "deploy"))).toBe(false);
    expect(fake.calls).toContainEqual(["alert", [expect.stringContaining("engine_missing")]]);
  });

  it("keeps a healthy image and prunes only other pulsa-bot-server tags", async () => {
    const images = [
      { repo: "pulsa-bot-server", tag: "main-20004735", id: "sha256:running", ref: candidate },
      { repo: "pulsa-bot-server", tag: "main-167d8e13", id: "sha256:prev", ref: previous },
      { repo: "pulsa-bot-server", tag: "main-old", id: "sha256:old", ref: "pulsa-bot-server:main-old" },
      { repo: "ubuntu", tag: "24.04", id: "sha256:ubuntu", ref: "ubuntu:24.04" },
    ];
    const fake = io({ images, running: previous });
    const result = await deployImage({ image: candidate, lock }, fake);
    expect(result.ok).toBe(true);
    expect(fake.calls).toContainEqual(["writePrevious", previous]);
    expect(fake.calls).toContainEqual(["deploy", candidate]);
    expect(result.pruned).toEqual(["pulsa-bot-server:main-old"]);
    expect(fake.state.previous).toBe(previous);
  });

  it("rolls back to the previous image and recreates caddy when startup reports engine_missing", async () => {
    const fake = io({
      smoke: {
        ok: true,
        healthz: '{"ok":true,"app":"openmausbot"}',
        log: `${startupLog()}\n[engines] engine_missing engineSet=all missing=grok`,
        imageId: "sha256:bad",
      },
    });
    const result = await deployImage({ image: candidate, lock }, fake);
    expect(result).toMatchObject({ ok: false, code: 1, rolledBack: true, previous });
    expect(fake.calls).toContainEqual(["deploy", candidate]);
    expect(fake.calls).toContainEqual(["deploy", previous]);
    expect(fake.calls).toContainEqual(["caddy", CADDY_RECREATE_ARGV]);
    expect(CADDY_RECREATE_COMMAND).toBe("docker compose up -d --force-recreate --no-deps pulsabot-caddy");
    expect(fake.calls).toContainEqual(["alert", ["[engines] engine_missing engineSet=all missing=grok"]]);
    expect(fake.calls.some((call) => Array.isArray(call) && call[0] === "writePrevious" && call[1] === candidate)).toBe(false);
  });

  it("uses the recorded previous image when nothing is running, and stops when there is none", async () => {
    const recorded = io({ running: "", previous, smoke: { ok: false, healthz: "", log: "", imageId: "" } });
    const rolled = await deployImage({ image: candidate, lock }, recorded);
    expect(rolled.rolledBack).toBe(true);
    expect(rolled.previous).toBe(previous);
    expect(recorded.calls.some((call) => Array.isArray(call) && call[0] === "writePrevious")).toBe(false);

    const none = io({ running: "", previous: "", smoke: { ok: false, healthz: "", log: "engine_missing", imageId: "" } });
    const failed = await deployImage({ image: candidate, lock }, none);
    expect(failed).toMatchObject({ ok: false, rolledBack: false });
    expect(none.calls.some((call) => Array.isArray(call) && call[0] === "caddy")).toBe(false);
    expect(none.calls).toContainEqual(["alert", ["engine_missing"]]);
  });

  it("rolls back when healthz is not ok", async () => {
    const fake = io({ smoke: { ok: true, healthz: '{"app":"openmausbot"}', log: startupLog(), imageId: "sha256:x" } });
    const result = await deployImage({ image: candidate, lock }, fake);
    expect(result.rolledBack).toBe(true);
    expect(result.errors).toContain("healthz not ok");
  });
});

describe("imagesToPrune", () => {
  const images = [
    { repo: "ghcr.io/org/pulsa-bot-server", tag: "main-a", id: "sha256:run", ref: "ghcr.io/org/pulsa-bot-server:main-a" },
    { repo: "ghcr.io/org/pulsa-bot-server", tag: "main-b", id: "sha256:prev", ref: "ghcr.io/org/pulsa-bot-server:main-b" },
    { repo: "ghcr.io/org/pulsa-bot-server", tag: "main-c", id: "sha256:old", ref: "ghcr.io/org/pulsa-bot-server:main-c" },
    { repo: "caddy", tag: "2", id: "sha256:caddy", ref: "caddy:2" },
  ];

  it("deletes nothing when the keep set is empty", () => {
    expect(imagesToPrune(images, [])).toEqual([]);
    expect(imagesToPrune(images, ["", null])).toEqual([]);
    expect(() => assertNotKept(images[2], [])).toThrow(/keep set is empty/);
  });

  it("keeps the running image and the previous image by tag and by id", () => {
    const keep = ["ghcr.io/org/pulsa-bot-server:main-a", "sha256:prev"];
    expect(imagesToPrune(images, keep).map((image) => image.ref)).toEqual(["ghcr.io/org/pulsa-bot-server:main-c"]);
    expect(() => assertNotKept(images[0], keep)).toThrow(/kept image/);
    expect(() => assertNotKept(images[1], keep)).toThrow(/kept image/);
    expect(() => assertNotKept(images[2], keep)).not.toThrow();
  });
});

describe("alertsFromLog", () => {
  it("alerts on every engine_missing line and ignores the rest", () => {
    const log = "[engines] claude: 1\n[engines] engine_missing engineSet=none missing=claude\nnoise\nengine_missing again";
    expect(alertsFromLog(log)).toEqual([
      "[engines] engine_missing engineSet=none missing=claude",
      "engine_missing again",
    ]);
    expect(alertsFromLog("[engines] self-check: 11/11 preinstalled engine(s) start (image set all)")).toEqual([]);
    expect(formatAlert(alertsFromLog(log)[0])).toBe("ALERT [engines] engine_missing engineSet=none missing=claude");
  });
});

describe("deploy script", () => {
  it("records the previous-image path and the exact caddy recreate", () => {
    const script = readFileSync(join(import.meta.dirname, "..", "deploy", "gox", "deploy-pulsabot.sh"), "utf8");
    expect(script).toContain(PREV_FILE);
    expect(script).toContain(CADDY_RECREATE_COMMAND);
    expect(script).toContain('exec node "$ROOT/scripts/gox-deploy.mjs"');
    expect(PREV_FILE).toBe("/opt/pulsatrix/pulsabot-image.prev");
  });
});
