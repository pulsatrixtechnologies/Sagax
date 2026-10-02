// The desktop app creates the Local VM on a person's PC through the desktop
// bridge (server mode) with electron/local-vm-recipe.mjs. That file is
// generated from container-computer.ts and must never drift from it: the same
// pinned image, Dockerfile, labels and hardened `run` arguments as solo mode.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BASE_IMAGE, CONTAINER, IMAGE, SHARED_LOCAL_VM_TARGET, containerRunArgs, imageLabelsMatch, managedImageDockerfile } from "./container-computer.ts";
import { BASE_IMAGE as DESKTOP_BASE, CONTAINER as DESKTOP_CONTAINER, DOCKERFILE, IMAGE as DESKTOP_IMAGE, IMAGE_LABELS, runArgs } from "../electron/local-vm-recipe.mjs";
import { localVmRecipeSource } from "../scripts/gen-local-vm-recipe.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("desktop Local VM recipe", () => {
  it("is the generated file of the current container-computer.ts (run scripts/gen-local-vm-recipe.ts)", () => {
    expect(readFileSync(join(ROOT, "electron", "local-vm-recipe.mjs"), "utf8")).toBe(localVmRecipeSource());
  });

  it("matches solo mode's image, Dockerfile, labels and hardened run arguments", () => {
    expect(DESKTOP_IMAGE).toBe(IMAGE);
    expect(DESKTOP_BASE).toBe(BASE_IMAGE);
    expect(DESKTOP_CONTAINER).toBe(CONTAINER);
    expect(DOCKERFILE).toBe(managedImageDockerfile());
    expect(imageLabelsMatch(IMAGE_LABELS)).toBe(true);
    const target = { ...SHARED_LOCAL_VM_TARGET, workspaceDir: "/Users/ada/.openmausbot/vm-home" };
    for (const runtime of ["docker", "podman"] as const) {
      expect(runArgs(runtime, "pw-123", target.workspaceDir)).toEqual(containerRunArgs(runtime, "pw-123", target));
    }
  });
});
