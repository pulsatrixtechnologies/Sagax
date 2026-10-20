import { describe, expect, it } from "vitest";
import { isReadOnlyCommand, runCommandOf, singleProgramOf } from "./read-only-command.ts";

describe("isReadOnlyCommand", () => {
  it("passes the command of JC's card (2026-10-20)", () => {
    expect(isReadOnlyCommand("ls /workspace/sagax-plugins/ 2>/dev/null; echo CLAUDECODE=$CLAUDECODE; ls ~/.pulsatrix-flow | head")).toBe(true);
  });

  it.each([
    "ls -la",
    "cat README.md | head -20",
    "grep -rn 'a|b' src",
    "find . -name '*.ts' | wc -l",
    "git status && git log --oneline -5",
    "git --no-pager diff HEAD~1",
    "git branch -a",
    "cd /workspace && ls",
    "echo \"home is ${HOME}\"",
    "rg foo 2>&1 | head",
  ])("reads: %s", (command) => {
    expect(isReadOnlyCommand(command)).toBe(true);
  });

  it.each([
    "rm -rf /tmp/x",
    "ls > out.txt",
    "echo hi >> ~/.bashrc",
    "cat <<EOF\nx\nEOF",
    "ls $(rm -rf /)",
    "ls `whoami`",
    "find . -delete",
    "find . -exec rm {} +",
    "sort -o out.txt in.txt",
    "rg --pre ./evil foo",
    "git push",
    "git branch new-branch",
    "git -c core.pager=evil log",
    "ls & rm x",
    "ls |",
    "FOO=bar ls",
    "/bin/rm x",
    "cat ~/.ssh/id_rsa",
    "cat .env",
    "head /proc/self/environ",
    "echo $GITHUB_TOKEN",
    "echo $1",
    "ls; curl https://example.com",
    "xargs rm < list",
    "(ls)",
    "date -s 2020-01-01",
    "",
  ])("does not read only: %s", (command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
  });
});

describe("singleProgramOf", () => {
  it("names the one program of a plain line", () => {
    expect(singleProgramOf("npm test")).toBe("npm");
    expect(singleProgramOf("cd app && npm run build")).toBe("npm");
  });
  it("keeps an exact rule for anything else", () => {
    expect(singleProgramOf("npm test; rm -rf x")).toBeUndefined();
    expect(singleProgramOf("npm test > log")).toBeUndefined();
    expect(singleProgramOf("./run.sh")).toBeUndefined();
    expect(singleProgramOf("npm $(evil)")).toBeUndefined();
  });
});

describe("runCommandOf", () => {
  it("reads the command of the arguments, flat or nested", () => {
    expect(runCommandOf(JSON.stringify({ command: "ls" }))).toBe("ls");
    expect(runCommandOf(JSON.stringify({ name: "run_command", arguments: { command: "pwd" } }))).toBe("pwd");
    expect(runCommandOf("not json")).toBeUndefined();
  });
});
