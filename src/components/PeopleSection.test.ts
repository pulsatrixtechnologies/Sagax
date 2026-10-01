import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readMembership } from "../lib/membership";
import { lastSeenLabel, PeopleTable, peopleFromSessions, PortalPeople, type Person } from "./PeopleSection";

describe("people table", () => {
  it("shows role chips, devices and spend, read-only", () => {
    const people: Person[] = [{ entry: "ada@example.test", role: "admin", isDomain: false, lastSeenAt: null, devices: 2, turns: 12, costUsd: 3.5, estimated: true }];
    const html = renderToStaticMarkup(createElement(PeopleTable, { people }));
    expect(html).toContain("ada@example.test");
    expect(html).toContain("Admin");
    expect(html).toContain("2 device(s)");
    expect(html).toContain("~$3.50");
    expect(html).not.toMatch(/Make admin|Make member|>Remove<|Invite link/);
    expect(lastSeenLabel(null)).toBe("Never");
    expect(lastSeenLabel(Date.now() - 60_000)).toBe("Today");
    expect(lastSeenLabel(Date.parse("2026-09-01T12:00:00Z"), Date.parse("2026-09-10T12:00:00Z"))).toBe("2026-09-01");
  });
});

describe("people on a workspace the organisation's Admin manages", () => {
  const url = "https://admin.example.test/people?workspace=acme";

  it("reads who decides membership defensively, defaulting to this server's own list", () => {
    expect(readMembership({ membership: { authority: "portal", pairingCodes: false, peopleUrl: url } })).toEqual({ authority: "portal", pairingCodes: false, peopleUrl: url });
    expect(readMembership({})).toEqual({ authority: "local", pairingCodes: true, peopleUrl: null });
    expect(readMembership(null)).toEqual({ authority: "local", pairingCodes: true, peopleUrl: null });
    for (const peopleUrl of ["javascript:alert(1)", "http://admin.example.test/people", "not a url", 7]) {
      expect(readMembership({ membership: { authority: "portal", peopleUrl } }).peopleUrl, String(peopleUrl)).toBeNull();
    }
  });

  it("lists who signed in, by address, with role from their sessions", () => {
    const people = peopleFromSessions(
      [
        { email: "Bob@acme.test", lastSeenAt: 2_000, scopes: ["client"] },
        { email: "ada@acme.test", lastSeenAt: 1_000, scopes: ["admin", "client"] },
        { email: "bob@acme.test", lastSeenAt: 7_000, scopes: ["client"] },
        { lastSeenAt: 9_000, scopes: ["admin", "client"] },
      ],
      [{ key: "user:bob@acme.test", turns: 3, costUsd: 1.25 }],
    );
    expect(people).toEqual([
      { entry: "ada@acme.test", role: "admin", isDomain: false, lastSeenAt: 1_000, devices: 1, turns: 0, costUsd: null },
      { entry: "bob@acme.test", role: "member", isDomain: false, lastSeenAt: 7_000, devices: 2, turns: 3, costUsd: 1.25 },
    ]);
  });

  it("says where people are managed, links there safely, and offers nothing to edit", () => {
    const people: Person[] = [{ entry: "bob@acme.test", role: "member", isDomain: false, lastSeenAt: null, devices: 1, turns: 3, costUsd: 1.25 }];
    const html = renderToStaticMarkup(createElement(PortalPeople, { peopleUrl: url, people }));
    expect(html).toContain("data-people-portal");
    expect(html).toContain("People are managed in your organization&#x27;s Admin");
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Manage people in Admin");
    expect(html).toContain("bob@acme.test");
    expect(html).toContain("$1.25");
    expect(html).not.toMatch(/Make admin|Make member|>Remove<|Invite link|<input|<form|pairing code|ends their account sessions/);
    expect(renderToStaticMarkup(createElement(PortalPeople, { peopleUrl: null, people: [] }))).toContain("Nobody has signed in here yet.");
  });
});
