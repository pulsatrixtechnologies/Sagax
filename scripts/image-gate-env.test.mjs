import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowPath = join(import.meta.dirname, "..", ".github/workflows/gox-image-gate.yml");
const source = readFileSync(workflowPath, "utf8");
const workflow = parse(source);

describe("manual image gate workflow env", () => {
  it("binds the dispatch image to IMAGE and never expands the input inside the script", () => {
    const step = workflow.jobs.gate.steps.find((item) => item.name === "Check the image manifest");
    expect(step?.env?.IMAGE).toBe("${{ inputs.image }}");
    expect(step?.run).toContain('docker pull "$IMAGE"');
    expect(step?.run).toMatch(/--image "\$IMAGE"/);
    expect(step?.run).not.toContain("${{ inputs.image }}");
    expect(step?.run).not.toContain("engine-image-gate.mjs");
  });
});
