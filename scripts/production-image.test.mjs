import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

describe("production image sources", () => {
  it("defaults the image to the full set and exports the build args", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("ARG ENGINE_SET=all");
    expect(dockerfile).not.toContain("ARG ENGINE_SET=none");
    expect(dockerfile).toContain("ARG SAGAX_REQUIRE_ENGINES=1");
    expect(dockerfile).toContain("ENV ENGINE_SET=${ENGINE_SET}");
    expect(dockerfile).toContain('org.opencontainers.image.revision="${SAGAX_COMMIT_SHA}"');
    expect(dockerfile).toContain('org.opencontainers.image.created="${SAGAX_BUILD_TIME}"');
    expect(dockerfile).toContain('io.sagax.engine-set="${SAGAX_ENGINE_SET}"');
    const engineCopy = dockerfile.indexOf("COPY engines.lock.json");
    const label = dockerfile.indexOf("ARG SAGAX_COMMIT_SHA=");
    expect(engineCopy).toBeGreaterThan(0);
    expect(label).toBeGreaterThan(engineCopy);
  });

  it("builds and publishes with ENGINE_SET=all and checks the running container", () => {
    const workflow = read(".github/workflows/docker.yml");
    expect(workflow).toContain("ENGINE_SET=all");
    expect(workflow).toContain("SAGAX_REQUIRE_ENGINES=1");
    expect(workflow).toContain("scripts/engine-image-gate.mjs");
    expect(workflow).toContain("--startup-log");
    expect(workflow).toContain("/healthz");
    expect(workflow).toContain("cursor-agent");
    expect(workflow).not.toContain("docker build -t openmausbot:ci .");
  });

  it("forwards the engine set from compose with an empty legacy ENGINES list", () => {
    const compose = read("deploy/docker-compose.yml");
    expect(compose).toContain("ENGINE_SET: ${ENGINE_SET:-all}");
    expect(compose).toContain("SAGAX_REQUIRE_ENGINES: ${SAGAX_REQUIRE_ENGINES:-1}");
    const example = read("deploy/.env.example");
    expect(example).toContain("ENGINES=");
    expect(example).not.toContain("ENGINES=@anthropic-ai/claude-code");
    const build = read("scripts/build-production-image.sh");
    expect(build).toContain("--build-arg ENGINE_SET=all");
    expect(build).toContain("--build-arg SAGAX_REQUIRE_ENGINES=1");
  });
});
