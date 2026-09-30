import { describe, expect, it } from "vitest";

import { permissionPaths } from "./permission-command.ts";

describe("permissionPaths", () => {
  const cwd = "/data/task-workspaces/bot-1/thread-1";
  it("reads the path fields of Claude's file tools, resolved against the working folder", () => {
    expect(permissionPaths("Write", { file_path: "/data/.claude/settings.json", content: "" }, cwd)).toEqual(["/data/.claude/settings.json"]);
    expect(permissionPaths("Edit", { file_path: "src/a.ts" }, cwd)).toEqual([`${cwd}/src/a.ts`]);
    expect(permissionPaths("NotebookEdit", { notebook_path: "../../bot-2/n.ipynb" }, cwd)).toEqual(["/data/task-workspaces/bot-2/n.ipynb"]);
    expect(permissionPaths("Grep", { pattern: "x", path: "/etc" }, cwd)).toEqual(["/etc"]);
  });
  it("uses the working folder for a search without a path", () => {
    expect(permissionPaths("Glob", { pattern: "**/*" }, cwd)).toEqual([cwd]);
    expect(permissionPaths("Write", { content: "" }, cwd)).toBeUndefined();
  });
  it("keeps a ~ path and a NUL byte relative, so they count as outside", () => {
    expect(permissionPaths("Read", { file_path: "~/.ssh/id_rsa" }, cwd)).toEqual(["~/.ssh/id_rsa"]);
    expect(permissionPaths("Read", { file_path: "/data/a\0b" }, cwd)).toEqual(["invalid"]);
  });
  it("names nothing for any other tool", () => {
    expect(permissionPaths("Bash", { command: "ls", path: "/" }, cwd)).toBeUndefined();
    expect(permissionPaths("WebFetch", { url: "https://example.test" }, cwd)).toBeUndefined();
  });
});
