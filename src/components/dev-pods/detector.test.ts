import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { DEV_MODE_OFF, ENTER_SCORE, EXIT_STREAK, devModeRequest, devModeStep, devSignals, toolKind, type DevModeState } from "./detector";
import { currentBranch, devChanges, devOutputs } from "./sources";

let seq = 0;
const text = (role: Message["role"], body: string): Message => ({ id: `m${++seq}`, role, kind: "text", text: body, at: seq });
const tool = (name: string, extra: Partial<NonNullable<Message["tool"]>> = {}): Message => ({
  id: `m${++seq}`, role: "bot", kind: "activity", at: seq, tool: { name, ok: true, ...extra },
});

describe("dev detector signals", () => {
  it("classifies git, gh pr, edit and shell rows", () => {
    expect(toolKind({ name: "Bash", summary: "git commit -m 'x'" })).toBe("git");
    expect(toolKind({ name: "Bash", summary: "gh pr create --title 'x'" })).toBe("pr");
    expect(toolKind({ name: "apply_patch" })).toBe("edit");
    expect(toolKind({ name: "Edit" })).toBe("edit");
    expect(toolKind({ name: "Bash", summary: "ls -la" })).toBe("shell");
    expect(toolKind({ name: "WebSearch" })).toBeNull();
  });

  it("scores a coding run above the threshold and a plain chat at zero", () => {
    const coding = [text("user", "fix the login bug"), tool("Read", { summary: "src/lib/auth.ts" }), tool("Edit", { summary: "src/lib/auth.ts" }), tool("Bash", { summary: "git commit -am fix" })];
    expect(devSignals({ messages: coding }).score).toBeGreaterThanOrEqual(ENTER_SCORE);
    const chat = [text("user", "what's the weather like?"), text("bot", "Sunny, 21 degrees."), text("user", "thanks")];
    expect(devSignals({ messages: chat }).score).toBe(0);
  });

  it("counts code blocks, pull request links and repo paths in replies", () => {
    const replies = [
      text("bot", "Here:\n```ts\nconst a = 1;\n```\nand\n```bash\npnpm test\n```"),
      text("bot", "Opened https://github.com/acme/app/pull/12 for src/components/Foo.tsx"),
    ];
    const signals = devSignals({ messages: replies });
    expect(signals.codeBlocks).toBe(2);
    expect(signals.prLinks).toBe(1);
    expect(signals.repoPaths).toBe(1);
    expect(signals.score).toBeGreaterThanOrEqual(ENTER_SCORE);
  });

  it("caps one chatty signal so reads alone never switch the pods on", () => {
    const shellOnly = Array.from({ length: 10 }, () => tool("Bash", { summary: "echo hi" }));
    expect(devSignals({ messages: shellOnly }).score).toBeLessThan(ENTER_SCORE);
  });

  it("an explicit mark or the computer adds to the score", () => {
    expect(devSignals({ messages: [], explicit: true }).score).toBeGreaterThanOrEqual(ENTER_SCORE);
    expect(devSignals({ messages: [], computerActive: true }).score).toBe(1);
  });
});

describe("dev detector: every engine's tool rows", () => {
  it("reads Codex and ACP rows, whose name is the command or a title", () => {
    // Codex and ACP engines (Grok, Cursor, OpenCode) name a shell call by
    // its command and a file edit by its title, with the written files.
    expect(toolKind({ name: "pnpm vitest run src/auth.test.ts", summary: "pnpm vitest run src/auth.test.ts" })).toBe("shell");
    expect(toolKind({ name: "git commit -am fix" })).toBe("git");
    expect(toolKind({ name: "git -C /repo push origin fix/login" })).toBe("git");
    expect(toolKind({ name: "Edit src/lib/auth.ts", files: ["src/lib/auth.ts"] })).toBe("edit");
    expect(toolKind({ name: "write_text", files: ["/home/me/app/main.py"] })).toBe("edit");
    // writing the bot's own notes is not development
    expect(toolKind({ name: "Write", files: ["/home/me/.sagax/bots/b1/MEMORY.md"] })).not.toBe("edit");
    expect(toolKind({ name: "List the bots" })).toBeNull();
  });

  it("an ACP coding run turns the pods on", () => {
    const run = [
      text("user", "fix the login bug"),
      tool("rg -n login src", { summary: "rg -n login src" }),
      tool("Edit src/lib/auth.ts", { files: ["src/lib/auth.ts"] }),
      tool("pnpm vitest run", { summary: "pnpm vitest run" }),
    ];
    expect(devSignals({ messages: run }).score).toBeGreaterThanOrEqual(ENTER_SCORE);
  });
});

describe("dev detector: the person asks for the coding view", () => {
  it("hears a request to turn it on, in English and in French", () => {
    for (const ask of ["Turn on coding mode", "switch to the coding experience please", "active le mode code", "Passe en mode développement", "affiche les pods de contexte"]) {
      const message = text("user", ask);
      expect(devModeRequest([message]), ask).toEqual({ mode: "on", id: message.id, at: message.at });
      expect(devSignals({ messages: [message] }).score, ask).toBeGreaterThanOrEqual(ENTER_SCORE);
    }
  });

  it("hears a request to turn it off, and the newest request wins", () => {
    const on = text("user", "turn on code mode");
    const off = text("user", "désactive le mode code");
    expect(devModeRequest([on, off])).toMatchObject({ mode: "off", id: off.id });
    expect(devModeRequest([off, on])).toMatchObject({ mode: "on", id: on.id });
  });

  it("ignores the bot's words and talk that only mentions code", () => {
    expect(devModeRequest([text("bot", "Turn on coding mode in Settings")])).toBeNull();
    expect(devModeRequest([text("user", "read our code of conduct")])).toBeNull();
    expect(devModeRequest([text("user", "what does the coding mode do?")])).toBeNull();
  });
});

describe("dev mode hysteresis", () => {
  const run = (scores: number[], start: DevModeState = DEV_MODE_OFF) => {
    const states: boolean[] = [];
    let state = start;
    for (const score of scores) {
      state = devModeStep(state, score);
      states.push(state.active);
    }
    return states;
  };

  it("stays off under the enter score", () => {
    expect(run([0, 1, 2, 3, 3, 2])).toEqual([false, false, false, false, false, false]);
  });

  it("turns on at the enter score and holds through a dip above the exit score", () => {
    expect(run([ENTER_SCORE, 2, 3, 2])).toEqual([true, true, true, true]);
  });

  it("does not flicker off on one or two quiet evaluations", () => {
    expect(run([ENTER_SCORE, 0, 0, 5, 0, 0])).toEqual([true, true, true, true, true, true]);
  });

  it(`turns off only after ${EXIT_STREAK} quiet evaluations in a row`, () => {
    const states = run([ENTER_SCORE, ...Array.from({ length: EXIT_STREAK }, () => 0)]);
    expect(states.at(-1)).toBe(false);
    expect(states.slice(0, -1).every(Boolean)).toBe(true);
  });

  it("returns the same state object when nothing changes", () => {
    const on = devModeStep(DEV_MODE_OFF, ENTER_SCORE);
    expect(devModeStep(on, ENTER_SCORE)).toBe(on);
    expect(devModeStep(DEV_MODE_OFF, 0)).toBe(DEV_MODE_OFF);
  });
});

describe("pod sources", () => {
  it("reads the branch from the newest git row, never a guess", () => {
    expect(currentBranch([text("user", "hi")])).toBeUndefined();
    const messages = [
      tool("Bash", { summary: "git checkout -b feat/old" }),
      tool("Bash", { summary: "git commit -m 'x'", output: "[feat/new 1a2b3c4] x\n 1 file changed" }),
    ];
    expect(currentBranch(messages)).toBe("feat/new");
    expect(currentBranch([tool("Bash", { summary: "git checkout -- src/a.ts" })])).toBeUndefined();
    expect(currentBranch([tool("Bash", { summary: "git switch -c fix/login", ok: false })])).toBeUndefined();
  });

  it("lists pull requests and commits the bot made, newest first, once each", () => {
    const messages = [
      tool("Bash", { summary: "git commit -m \"Fix the login\"", output: "[main abcdef1] Fix the login" }),
      tool("Bash", { summary: "gh pr create --title \"Login fix\" --body x", output: "https://github.com/acme/app/pull/42\n" }),
      text("bot", "Done: https://github.com/acme/app/pull/42"),
    ];
    const changes = devChanges(messages);
    expect(changes.map((change) => change.key)).toEqual(["pull:acme/app#42", "commit:abcdef1"]);
    // the reply's bare link is newer, the title still comes from gh pr create
    expect(changes[0]).toMatchObject({ kind: "pull", title: "Login fix", repo: "acme/app", number: 42, url: "https://github.com/acme/app/pull/42" });
    expect(changes[1]).toMatchObject({ kind: "commit", title: "Fix the login", sha: "abcdef1" });
  });

  it("lists the files the bot attached, not the person's", () => {
    const fromBot: Message = { ...text("bot", "here"), attachments: [{ kind: "file", path: "/api/files/a/report.pdf", mime: "application/pdf", name: "report.pdf" }] };
    const fromPerson: Message = { ...text("user", "mine"), attachments: [{ kind: "image", path: "/api/files/b/me.png", mime: "image/png" }] };
    expect(devOutputs([fromPerson, fromBot]).map((output) => output.name)).toEqual(["report.pdf"]);
  });
});
