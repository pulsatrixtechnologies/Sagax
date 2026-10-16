import { Box } from "lucide-react";
import { describe, expect, it } from "vitest";
import { arrangePods, devPodDefinitions, registerDevPod, unregisterDevPod, type DevPodDefinition } from "./registry";
import { railGeometry, RAIL_EDGE, RAIL_GAP, RAIL_MAX, RAIL_MIN, TRANSCRIPT_MAX } from "./DevPods";
import "./all-pods";

const pod = (id: string, order: number): DevPodDefinition => ({
  id, order, title: () => id, icon: Box, collapsible: true, useData: () => ({ status: "empty" }), Body: () => null,
});

describe("dev pod registry", () => {
  it("registers every file under pods/ by itself", () => {
    expect(devPodDefinitions().map((definition) => definition.id)).toEqual(["environment", "context", "connectors", "outputs", "changes"]);
  });

  it("adds a pod by id and replaces one registered again", () => {
    registerDevPod(pod("zz-test", 5));
    expect(devPodDefinitions()[0]!.id).toBe("zz-test");
    registerDevPod(pod("zz-test", 99));
    expect(devPodDefinitions().filter((definition) => definition.id === "zz-test")).toHaveLength(1);
    expect(devPodDefinitions().at(-1)!.id).toBe("zz-test");
    unregisterDevPod("zz-test");
    expect(devPodDefinitions().some((definition) => definition.id === "zz-test")).toBe(false);
  });

  it("arranges by the saved order, then the default order, minus hidden pods", () => {
    const definitions = [pod("a", 1), pod("b", 2), pod("c", 3), pod("d", 4)];
    expect(arrangePods(definitions, [], []).map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
    expect(arrangePods(definitions, ["c", "gone", "a"], ["b"]).map((d) => d.id)).toEqual(["c", "a", "d"]);
  });
});

describe("rail geometry", () => {
  it("fits only when the gutter right of the centered transcript holds the rail", () => {
    const needed = TRANSCRIPT_MAX + 2 * (RAIL_MIN + RAIL_EDGE + RAIL_GAP);
    expect(railGeometry(needed)).toEqual({ fits: true, width: RAIL_MIN });
    expect(railGeometry(needed - 2).fits).toBe(false);
    expect(railGeometry(2400)).toEqual({ fits: true, width: RAIL_MAX });
    // narrow: floated over the transcript, never wider than the pane
    expect(railGeometry(1100).fits).toBe(false);
    expect(railGeometry(200)).toEqual({ fits: false, width: 200 - 2 * RAIL_EDGE });
  });
});
