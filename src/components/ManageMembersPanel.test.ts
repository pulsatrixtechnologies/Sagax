import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ bots: [] as unknown[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: { viewer: { principalId: "pr_me" } }, bots: fixture.bots }, dispatch: vi.fn() }) };
});

const { ManageMembersPanel } = await import("./ManageMembersPanel");

const bot = (id: string, name: string, ownerUserId: string) => ({ id, threadId: `t-${id}`, name, color: "green", ownerUserId, messages: [], tasks: [] }) as unknown as Bot;
fixture.bots = [bot("atlas", "Atlas", "pr_me"), bot("iris", "Iris", "pr_me"), bot("support", "Support", "pr_ada")];
const group = { id: "ops", threadId: "t-ops", name: "Ops", memberIds: ["support", "atlas"], humanIds: ["pr_ada", "pr_me"], messages: [] } as unknown as Group;
const people = [{ id: "pr_me", label: "Me" }, { id: "pr_ada", label: "Ada Example" }];

function render(props: Partial<Parameters<typeof ManageMembersPanel>[0]>) {
  return renderToStaticMarkup(createElement(ManageMembersPanel, { group, onClose: () => {}, people, ...props }));
}

describe("ManageMembersPanel (#1240, #1260)", () => {
  it("lists the room's people and its bots in one dialog for the owner", () => {
    const html = render({ ownsRoom: true, canAddHuman: true, organization: true, focus: "people" });
    expect(html).toContain('data-roster-section="people"');
    expect(html).toContain('data-roster-section="bots"');
    expect(html).toContain('data-manage-members="people"');
    expect(html).toContain('type="search"');
    expect(html).toContain("Ada Example");
    // every bot, ticked for who is in
    expect(html).toContain('aria-label="Support" aria-checked="true"');
    expect(html).toContain('aria-label="Iris" aria-checked="false"');
  });

  it("lets a member who does not own the room tick only their own bots, people read-only", () => {
    const html = render({ ownsRoom: false, canAddHuman: false, organization: true, focus: "bots" });
    expect(html).toContain('aria-label="Atlas" aria-checked="true"');
    expect(html).toContain('aria-label="Iris" aria-checked="false"');
    expect(html).not.toContain('aria-label="Support"');
    expect(html).not.toContain('type="search"');
    expect(html).toMatch(/data-roster-person="pr_ada"[^>]*disabled=""|disabled=""[^>]*data-roster-person="pr_ada"/);
  });

  it("adds people by email off an organization server", () => {
    const html = render({ ownsRoom: true, canAddHuman: true, organization: false });
    expect(html).toContain('type="search"');
    expect(html).toContain("email");
  });
});
