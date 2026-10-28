import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OrgDirectory } from "@/lib/perspicax-org";
import { GroupPeoplePicker } from "./GroupPeoplePicker";

const directory = {
  people: [
    { principalId: "pr_ada", name: "Ada Lovelace", login: "ada", role: "member" as const, disabled: false },
    { principalId: "pr_bob", name: "Bob Martin", login: "bob", role: "member" as const, disabled: false },
  ],
  teams: [],
} as unknown as OrgDirectory;

describe("GroupPeoplePicker", () => {
  it("lists directory people who are not already in the room, with Add and Done", () => {
    const html = renderToStaticMarkup(createElement(GroupPeoplePicker, {
      directory,
      taken: ["pr_ada"],
      onAdd: () => {},
      onDone: () => {},
    }));
    expect(html).toContain("data-group-people-picker");
    expect(html).toContain('data-add-person="pr_bob"');
    expect(html).not.toContain('data-add-person="pr_ada"');
    expect(html).toContain("Bob Martin");
    expect(html).toContain('aria-label="Search people"');
    expect(html).toContain("Done");
  });

  it("asks for an email off an organization server", () => {
    const html = renderToStaticMarkup(createElement(GroupPeoplePicker, {
      directory: null,
      taken: [],
      organization: false,
      onAdd: () => {},
      onDone: () => {},
    }));
    expect(html).toContain('aria-label="Add by email address"');
    expect(html).not.toContain("data-add-person");
    expect(html).toContain("Done");
  });
});
