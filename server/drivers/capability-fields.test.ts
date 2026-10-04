// Capability-field contract tests for the cloud computer. Whether an engine
// can work on it is one rule over two facts (shared/cloud-computer.ts): it has
// computer tools (computerMcp) or it is the Computer engine, which runs there.
// These pin each driver's facts; the fleet invariant at the bottom keeps
// remoteAgent exactly the boat-native driver.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { canWorkOnCloud } from "../../shared/cloud-computer.ts";
import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { BoatAgentDriver } from "./boatagent.ts";
import { BUILT_IN_DRIVERS } from "./builtIn.ts";
import { ClaudeDriver } from "./claude.ts";
import { CodexDriver } from "./codex.ts";
import { OpenAICompatDriver } from "./openai-compat.ts";
import { PiDriver } from "./pi.ts";

const created: ProviderInstance[] = [];
const onBoat = (instance: ProviderInstance) =>
  canWorkOnCloud({ driverKind: instance.driverKind, computerMcp: instance.adapter.capabilities.computerMcp }, "box");
const keep = async (promise: Promise<ProviderInstance>): Promise<ProviderInstance> => {
  const instance = await promise;
  created.push(instance);
  return instance;
};

describe("typed capability fields for the cloud computer", () => {
  beforeEach(() => {
    ensureDirs();
  });

  afterEach(async () => {
    for (const instance of created.splice(0)) await instance.dispose();
  });

  it("declares the box-native engine remote and cloud-bound without computer tools", async () => {
    const boat = await keep(BoatAgentDriver.create({
      instanceId: "caps-box", displayName: "Caps Boat",
      environment: { BOX_TOKEN: "boat-test-token" }, enabled: true, config: { pollMs: 0 },
    }));
    expect(boat.adapter.capabilities.remoteAgent).toBe(true);
    expect(onBoat(boat)).toBe(true);
    expect(boat.adapter.capabilities.computerMcp).toBeUndefined();
  });

  it("keeps the chat runtime's cloud computer locked to its computer tools", async () => {
    const mounted = await keep(OpenAICompatDriver.create({
      instanceId: "caps-compat", displayName: "Caps Compat", environment: {}, enabled: true,
      config: OpenAICompatDriver.defaultConfig(),
    }));
    expect(mounted.adapter.capabilities.computerMcp).toBe(true);
    expect(onBoat(mounted)).toBe(true);
    expect(mounted.adapter.capabilities.remoteAgent).toBeUndefined();
    // Tools off means the runtime has no computer tools to mount the cloud
    // computer into, so both gates must fall together.
    const bare = await keep(OpenAICompatDriver.create({
      instanceId: "caps-compat-bare", displayName: "Caps Compat Bare", environment: {}, enabled: true,
      config: { ...OpenAICompatDriver.defaultConfig(), tools: false },
    }));
    expect(bare.adapter.capabilities.computerMcp).toBe(false);
    expect(onBoat(bare)).toBe(false);
  });

  it("lets host-harness drivers with computer tools use the cloud computer on their own engine", async () => {
    // These ran on a swapped-in Computer engine before, which could not sign
    // in on an OMB Cloud (provider_not_configured).
    const claude = await keep(ClaudeDriver.create({
      instanceId: "caps-claude", displayName: "Caps Claude", environment: {}, enabled: true,
      config: ClaudeDriver.defaultConfig(),
    }));
    expect(claude.adapter.capabilities.remoteAgent).toBeUndefined();
    expect(onBoat(claude)).toBe(true);
    const codex = await keep(CodexDriver.create({
      instanceId: "caps-codex", displayName: "Caps Codex", environment: {}, enabled: true,
      config: CodexDriver.defaultConfig(),
    }));
    expect(codex.adapter.capabilities.remoteAgent).toBeUndefined();
    expect(onBoat(codex)).toBe(true);
    const pi = await keep(PiDriver.create({
      instanceId: "caps-pi", displayName: "Caps Pi", environment: {}, enabled: true,
      config: PiDriver.defaultConfig(),
    }));
    expect(pi.adapter.capabilities.remoteAgent).toBeUndefined();
    expect(onBoat(pi)).toBe(true);
  });

  it("holds the fleet invariant the swapped reads rely on", async () => {
    for (const driver of BUILT_IN_DRIVERS) {
      const instance = await keep(driver.create({
        instanceId: `caps-fleet-${driver.driverKind}`, displayName: "Caps Fleet", environment: {}, enabled: true,
        config: driver.driverKind === "customAcp" ? { cli: "echo" } : {},
      }));
      const caps = instance.adapter.capabilities;
      // remoteAgent is exactly the boat-native driver: this biconditional is
      // what lets every former driverKind === "boxAgent" capability read
      // become caps.remoteAgent === true without changing an outcome.
      expect(caps.remoteAgent === true, driver.driverKind).toBe(driver.driverKind === "boxAgent");
    }
  });
});
