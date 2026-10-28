import { describe, expect, it } from "vitest";

import {
  cleanRoutineFolder,
  groupRoutinesByFolder,
  orderedRoutineFolders,
  routinePrefixFolder,
  routinePrefixPlan,
  ROUTINE_FOLDER_MAX,
} from "./routine-folders.ts";

describe("routine folder names", () => {
  it("cleans spaces and control characters, caps the length, and treats empty as no folder", () => {
    expect(cleanRoutineFolder("  Home \n lab ")).toBe("Home lab");
    expect(cleanRoutineFolder("")).toBeUndefined();
    expect(cleanRoutineFolder("   ")).toBeUndefined();
    expect(cleanRoutineFolder(null)).toBeUndefined();
    expect(cleanRoutineFolder("x".repeat(200))).toHaveLength(ROUTINE_FOLDER_MAX);
  });

  it("reads a leading [Prefix] as a folder, and nothing else", () => {
    expect(routinePrefixFolder("[Daily] Morning summary")).toEqual({ folder: "Daily", name: "Morning summary" });
    expect(routinePrefixFolder("  [Home lab] - Backups check")).toEqual({ folder: "Home lab", name: "Backups check" });
    expect(routinePrefixFolder("[Dev]")).toBeNull();
    expect(routinePrefixFolder("Morning [Daily] summary")).toBeNull();
    expect(routinePrefixFolder("[] Empty")).toBeNull();
    expect(routinePrefixFolder("Plain title")).toBeNull();
  });
});

describe("grouping", () => {
  const routines = [
    { id: "1", name: "Loose", folder: undefined },
    { id: "2", name: "A", folder: "Reports" },
    { id: "3", name: "B", folder: "reports" },
    { id: "4", name: "C", folder: "Zed" },
  ];

  it("keeps the saved order, then adds folders only routines name, by name", () => {
    expect(orderedRoutineFolders(["Zed", "Empty"], routines)).toEqual(["Zed", "Empty", "Reports"]);
  });

  it("puts routines in no folder first, then one section per folder (empty ones included), case-insensitively", () => {
    const groups = groupRoutinesByFolder(routines, ["Reports", "Empty", "Zed"]);
    expect(groups.map((group) => [group.folder, group.routines.map((routine) => routine.id)])).toEqual([
      [null, ["1"]],
      ["Reports", ["2", "3"]],
      ["Empty", []],
      ["Zed", ["4"]],
    ]);
  });

  it("plans Sort by prefix only for routines in no folder whose name has a prefix", () => {
    expect(routinePrefixPlan([
      { id: "1", name: "[Daily] Morning summary" },
      { id: "2", name: "[Dev] Filed", folder: "Kept" },
      { id: "3", name: "Weekly review" },
    ])).toEqual([{ id: "1", folder: "Daily", name: "Morning summary" }]);
  });
});
