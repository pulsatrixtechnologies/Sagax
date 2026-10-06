// The group panel's Memory tab: the owner edits and switches it, the group's
// other people read it only. The server decides who is the owner (canEdit).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GROUP_PANEL_TABS } from "./GroupPanel";
import { GroupMemoryBody } from "./GroupMemoryTab";
import type { GroupMemoryView } from "@/lib/group-memory";

const capacity = { lines: 1, bytes: 20, maxLines: 200, maxBytes: 24_000, loadedLines: 1, loadedBytes: 20, truncated: false, hash: "h" };
const view = (extra: Partial<GroupMemoryView> = {}): GroupMemoryView => ({ enabled: true, canEdit: true, text: "- deploys after 17h\n", hash: "h", capacity, ...extra });
const noop = () => {};
const render = (v: GroupMemoryView, draft = v.text, conflict = false) => renderToStaticMarkup(createElement(GroupMemoryBody, {
  view: v, draft, conflict, error: null, saving: false,
  onDraft: noop, onReset: noop, onSave: noop, onToggle: noop, onReload: noop, onOverwrite: noop,
}));

describe("GroupMemoryTab", () => {
  it("is a tab of the group panel", () => {
    expect(GROUP_PANEL_TABS).toContain("memory");
  });

  it("lets the owner edit and switch the group memory", () => {
    const html = render(view(), "- deploys after 17h\n- standup at 9\n");
    expect(html).toContain("Group memory");
    expect(html).toContain("deploys after 17h");
    expect(html).not.toContain('readOnly=""');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(html).not.toMatch(/<button disabled=""[^>]*role="switch"/);
    expect(html).toContain("Save");
    expect(html).not.toContain("Only the owner of this group");
  });

  it("shows the group memory read-only to another member", () => {
    const html = render(view({ canEdit: false }));
    expect(html).toContain('readOnly=""');
    expect(html).toContain("Only the owner of this group can change its memory.");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain(">Save<");
  });

  it("says when it is off and when a bot wrote meanwhile", () => {
    expect(render(view({ enabled: false }))).toContain("Off: the bots neither read nor write it.");
    const html = render(view(), "- mine\n", true);
    expect(html).toContain("A bot changed the group memory while you were editing.");
    expect(html).toContain("Overwrite with mine");
  });

  it("asks the server, never guesses who may edit", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(view({ canEdit: false })), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGroupMemory, saveGroupMemory } = await import("@/lib/group-memory");
    expect((await fetchGroupMemory("g1")).canEdit).toBe(false);
    await saveGroupMemory("g1", { enabled: false });
    expect(fetchMock.mock.calls.map((call) => [String((call as unknown[])[0]), ((call as unknown[])[1] as RequestInit | undefined)?.method ?? "GET"]))
      .toEqual([["/api/groups/g1/memory", "GET"], ["/api/groups/g1/memory", "PUT"]]);
    vi.unstubAllGlobals();
  });
});
