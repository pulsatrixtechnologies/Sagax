// Guard for JC's rule (2026-10-19): "N'affiche JAMAIS des GUID, on ne
// comprend rien." Key screens and labels are rendered with fixtures whose
// ids are UUIDs (bots, conversations, people, engines, accounts, folders);
// the test fails when a UUID, whole or cut short, reaches visible text. An
// id may stay in a tooltip (title) or a Copy action: attributes are not
// visible text and are left out.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { containsUuid, isOpaqueId, quotedIdOr, readableOr, sagaxFolder } from "../../shared/human-id";
import { setLocale, t } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";

vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => null,
}));

const { botLabel, engineLabel, personLabel } = await import("./human-label");
const { humanPath, shortPath } = await import("./short-path");
const { VerifyCard } = await import("@/components/VerifyCard");
await import("@/components/dev-pods/all-pods");
const { devPodDefinitions } = await import("@/components/dev-pods/registry");
const { environmentData } = await import("@/components/dev-pods/pods/environment");
const { folderLabel } = await import("@/components/dev-pods/sources");
const { connectedAccountLabel, disconnectAccountConfirmation } = await import("@/components/plugins/connected-apps");
const { personLabel: directoryPersonLabel } = await import("@/components/OrgDirectory");
const { runAsOptionLabel } = await import("@/components/routines/RunAsField");
const { ownerLabel } = await import("@/components/settings/OrgSharing");

const BOT_ID = "5752d21c-e77c-4a83-84f0-66048216a5df";
const THREAD_ID = "d4eb1f10-ceef-428a-afdd-d53d1194c2e7";
const PERSON_ID = "pr_0b6f3c1e-2d4a-4c55-9a3b-7e1f00c2d9aa";
const ENGINE_ID = "claude-3f2a9d10-6b7c-4e21-8a0f-5c4d3e2b1a09";
const ACCOUNT_ID = "ca_9Xk2LmQ7pR4tV8wZ1yB3nC6d";
const TASK_FOLDER = `/Users/ann/Library/Application Support/Sagax/task-workspaces/${BOT_ID}/${THREAD_ID}`;

/** The text a person sees: markup without tags or attributes. */
function visibleText(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function expectNoUuid(text: string): void {
  expect(containsUuid(text), `a UUID is visible: ${text}`).toBe(false);
}

describe("shared/human-id", () => {
  it("recognises UUIDs, whole or cut short, and other opaque ids", () => {
    expect(isOpaqueId(THREAD_ID)).toBe(true);
    expect(isOpaqueId(PERSON_ID)).toBe(true);
    expect(isOpaqueId(ENGINE_ID)).toBe(true);
    expect(isOpaqueId(ACCOUNT_ID)).toBe(true);
    expect(isOpaqueId("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b")).toBe(true);
    expect(containsUuid("d4eb1f10-ceef-428a-afdd-d53d119…")).toBe(true);
    expect(containsUuid("Environment d4eb1f10-ceef-428a")).toBe(true);
    expect(isOpaqueId("21m00Tcm4TlvDq8ikWAM")).toBe(true);
    for (const name of ["claude", "Pepper", "sagax", "feat/login-redirect", "ann@example.com", "build-01", "work-2024-10-19", "team_engineeringplatform", "release-candidatebuildnotes", "codex-2", "ara"]) {
      expect(isOpaqueId(name), name).toBe(false);
      expect(containsUuid(name), name).toBe(false);
    }
  });

  it("names the folders Sagax makes after ids", () => {
    expect(sagaxFolder(TASK_FOLDER)).toEqual({ kind: "conversation", rest: [] });
    expect(sagaxFolder(`${TASK_FOLDER}/src/app`)).toEqual({ kind: "conversation", rest: ["src", "app"] });
    expect(sagaxFolder(`/data/parallel-worktrees/${BOT_ID}/${THREAD_ID}`)).toEqual({ kind: "parallel", rest: [] });
    expect(sagaxFolder(`/data/workspaces/${BOT_ID}`)).toEqual({ kind: "bot", rest: [] });
    expect(sagaxFolder("/Users/ann/work/sagax")).toBeNull();
  });

  it("keeps a readable name and replaces an opaque one", () => {
    expect(readableOr("Work", "Account 1")).toBe("Work");
    expect(readableOr(ACCOUNT_ID, "Account 1")).toBe("Account 1");
    expect(quotedIdOr("ghost", "the selected engine")).toBe("\"ghost\"");
    expect(quotedIdOr(ENGINE_ID, "the selected engine")).toBe("the selected engine");
  });
});

describe("no UUID on screen", () => {
  setLocale("en");

  it("paths read as folders, never as ids", () => {
    expect(shortPath(TASK_FOLDER, "/Users/ann")).toBe(t("folder.conversation"));
    expect(shortPath(`${TASK_FOLDER}/src`, "/Users/ann")).toBe(`${t("folder.conversation")}/src`);
    expect(shortPath("/Users/ann/work", "/Users/ann")).toBe("~/work");
    expectNoUuid(humanPath(`/srv/cache/${THREAD_ID}/out`));
    expect(folderLabel(TASK_FOLDER)).toBe(t("folder.conversation"));
    expect(folderLabel(`${TASK_FOLDER}/web`)).toBe("web");
    expect(folderLabel("/Users/ann/sagax")).toBe("sagax");
  });

  it("the Environment card names the folder and the branch, the id only in tooltips", () => {
    const definition = devPodDefinitions().find((entry) => entry.id === "environment")!;
    const branchRow: Message = {
      id: "m1", role: "bot", kind: "activity", at: 1,
      tool: { name: "Bash", ok: true, summary: `git switch sagax/parallel-${THREAD_ID.slice(0, 12)}`, output: `Switched to branch 'sagax/parallel-${THREAD_ID.slice(0, 12)}'` },
    };
    const bot = { id: BOT_ID, threadId: THREAD_ID, name: "Pepper", cwd: TASK_FOLDER, computer: "local", messages: [branchRow], tasks: [] } as unknown as Bot;
    const data = environmentData({ bot, task: undefined, messages: [branchRow], computerStart: undefined });
    expect(data).not.toBeNull();
    const markup = renderToStaticMarkup(createElement(definition.Body, { data, ctx: { bot, task: undefined, messages: [branchRow], threadKey: `${BOT_ID}:${THREAD_ID}`, computerStart: undefined, dispatch: () => undefined } }));
    const text = visibleText(createElement(definition.Body, { data, ctx: { bot, task: undefined, messages: [branchRow], threadKey: `${BOT_ID}:${THREAD_ID}`, computerStart: undefined, dispatch: () => undefined } }));
    expectNoUuid(text);
    expect(text).toContain(t("folder.conversation"));
    expect(text).toContain(t("folder.parallelBranch"));
    // the full path stays reachable for support, in the tooltip
    expect(markup).toContain(`title="${TASK_FOLDER}"`);
  });

  it("the This run card shows commands and labels, not step ids", () => {
    const text = visibleText(createElement(VerifyCard, {
      steps: [
        { id: THREAD_ID, label: "ssh", command: "ssh build-01 \"df -h\"", status: "passed", dryRun: false, verified: false },
        { id: BOT_ID, label: "git commit", command: "git commit -m \"Fix\"", status: "running", dryRun: false, verified: false },
      ],
      canSave: true, skill: null, onDismiss: () => undefined, onSave: () => undefined,
    }));
    expectNoUuid(text);
    expect(text).toContain("ssh build-01");
  });

  it("people, bots, engines and accounts read by name or a plain word", () => {
    const labels = [
      personLabel(undefined, PERSON_ID),
      personLabel("", "ann@example.com", PERSON_ID),
      botLabel(undefined, BOT_ID),
      engineLabel(undefined, ENGINE_ID),
      connectedAccountLabel({ id: ACCOUNT_ID }, 0),
      disconnectAccountConfirmation("Gmail", { id: ACCOUNT_ID }),
      directoryPersonLabel({ id: PERSON_ID } as Parameters<typeof directoryPersonLabel>[0]),
      runAsOptionLabel({ principalId: PERSON_ID, name: "", selectable: false }),
      ownerLabel({ ownerName: "", ownerPrincipalId: PERSON_ID } as Parameters<typeof ownerLabel>[0]),
    ];
    for (const label of labels) {
      expectNoUuid(label);
      expect(isOpaqueId(label), label).toBe(false);
    }
    expect(personLabel(undefined, PERSON_ID)).toBe(t("ids.unknownPerson"));
    expect(personLabel("", "ann@example.com", PERSON_ID)).toBe("ann@example.com");
    expect(botLabel(undefined, BOT_ID)).toBe(t("ids.deletedBot"));
    expect(engineLabel(undefined, ENGINE_ID)).toBe(t("ids.removedEngine"));
    expect(engineLabel(undefined, "claude")).toBe("claude");
    expect(connectedAccountLabel({ id: ACCOUNT_ID, alias: "Work" }, 0)).toBe("Work");
    expect(connectedAccountLabel({ id: ACCOUNT_ID }, 1)).toBe(t("ids.accountN", { n: 2 }));
  });
});
