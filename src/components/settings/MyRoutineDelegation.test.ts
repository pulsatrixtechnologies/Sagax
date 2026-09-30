// Slice 6: routine delegation in the web app: Settings > Organization >
// Routines in my name, the consent's return on the address, the paused
// routine card with its reconnect button, and the routine badges.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseRoutineDelegationHash, routineDelegationReturnText } from "@/lib/routine-delegation";
import type { Routine } from "@/lib/routines";
import { accessCardLines, AccessCard } from "../AccessCard";
import { RoutineDelegationBanner, RoutineList, routineSuspendedText } from "../routines/RoutineList";
import { MyRoutineDelegation } from "./MyRoutineDelegation";

const OWNER = "pr_00000000-0000-4000-8000-0000000000a0";
const BOB = "pr_00000000-0000-4000-8000-0000000000b0";

describe("Routines in my name (slice 6)", () => {
  it("offers to allow when there is no delegation, and counts paused routines", () => {
    const markup = renderToStaticMarkup(createElement(MyRoutineDelegation, { initial: { state: "none", suspended: 2 } }));
    expect(markup).toContain("Routines in my name");
    expect(markup).toContain("Not allowed. Your routines are paused until you allow them.");
    expect(markup).toContain("2 paused routine(s)");
    expect(markup).toContain("Allow my routines to act in my name");
    expect(markup).not.toContain("Revoke");
    expect(markup).toContain('data-routine-delegation="none"');
  });

  it("shows since when it is allowed, and the revoke button", () => {
    const markup = renderToStaticMarkup(createElement(MyRoutineDelegation, {
      initial: { state: "active", consentedAt: Date.UTC(2026, 8, 30, 10), renewedAt: Date.UTC(2026, 8, 30, 11), expiresAt: Date.UTC(2026, 9, 30, 11), suspended: 0 },
    }));
    expect(markup).toContain("Allowed since");
    expect(markup).toContain("Revoke");
    expect(markup).not.toContain("paused routine");
    expect(markup).not.toContain("Allow my routines");
  });

  it("reads the consent's return from the address, and says what went wrong", () => {
    expect(parseRoutineDelegationHash("#routine-delegation=ok")).toEqual({ ok: true });
    expect(parseRoutineDelegationHash("#routine-delegation-error=routines_subject")).toEqual({ ok: false, code: "routines_subject" });
    expect(parseRoutineDelegationHash("#routine-delegation-error=<script>")).toBeNull();
    expect(parseRoutineDelegationHash("#signin_error=binding")).toBeNull();
    expect(parseRoutineDelegationHash("")).toBeNull();
    expect(routineDelegationReturnText({ ok: true })).toBe("Your routines can act in your name.");
    expect(routineDelegationReturnText({ ok: false, code: "routines_subject" })).toBe("You signed in to Perspicax with another account. Try again with yours.");
    expect(routineDelegationReturnText({ ok: false, code: "routines_scope" })).toBe("Perspicax did not grant routine delegation. It needs an update.");
    expect(routineDelegationReturnText({ ok: false, code: "routines_session" })).toBe("Your session ended during the authorization. Sign in and try again.");
    expect(routineDelegationReturnText({ ok: false, code: "binding" })).toBe("The authorization did not complete (binding).");
    expect(routineDelegationReturnText({ ok: false, code: "rate_limited" })).toBe("Perspicax is busy right now. Wait a minute and allow your routines again.");
    expect(parseRoutineDelegationHash("#routine-delegation-error=rate_limited")).toEqual({ ok: false, code: "rate_limited" });
  });
});

describe("the paused routine card (slice 6)", () => {
  const card = {
    reason: "routine_delegation" as const, engine: "", botId: "bot-1", ownerPrincipalId: OWNER,
    runAsPrincipalId: BOB, runAsName: "Bob", routineId: "r1", routineName: "Hourly report", suspendReason: "delegation_revoked" as const,
  };

  it("gives the person it runs as the reconnect button, and everyone else the text only", () => {
    expect(accessCardLines(card, { principalId: BOB, admin: false })).toEqual({
      text: "The routine \"Hourly report\" is paused: it cannot act in Bob's name.",
      hint: "The permission was revoked.",
      reconnect: true,
    });
    expect(accessCardLines(card, { principalId: OWNER, admin: true })).toEqual({
      text: "The routine \"Hourly report\" is paused: it cannot act in Bob's name.",
      hint: "The permission was revoked.",
    });
    expect(renderToStaticMarkup(createElement(AccessCard, { access: card, viewer: { principalId: BOB, admin: false } }))).toContain("Reconnect my routines");
    expect(renderToStaticMarkup(createElement(AccessCard, { access: card, viewer: { principalId: OWNER, admin: false } }))).not.toContain("Reconnect my routines");
  });

  it("offers no reconnect when the person lost the right to run the bot", () => {
    expect(accessCardLines({ ...card, suspendReason: "no_right" }, { principalId: BOB, admin: false })).toEqual({
      text: "The routine \"Hourly report\" is paused: it cannot act in Bob's name.",
      hint: "This person can no longer run this bot's routines.",
    });
  });
});

describe("routine badges (slice 6)", () => {
  const routine = {
    id: "r1", name: "Hourly report", prompt: "p", target: "bot", botId: "bot-1", runOn: "maus", enabled: true,
    schedule: { type: "cron", expression: "0 * * * *", timeZone: "UTC" }, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1,
    runAs: { principalId: BOB, name: "Bob" }, suspended: { reason: "delegation_missing", at: 5 },
  } as unknown as Routine;

  it("says who a routine runs as and why it is paused", () => {
    const markup = renderToStaticMarkup(createElement(RoutineList, { routines: [routine], runs: [], onOpen: () => {} }));
    expect(markup).toContain("Runs as Bob");
    expect(markup).toContain("Paused: not allowed yet");
    expect(routineSuspendedText("person_out")).toBe("Paused: person signed out");
  });

  it("shows the banner only to the person the routines run as, without a delegation", () => {
    expect(renderToStaticMarkup(createElement(RoutineDelegationBanner, { routines: [routine], viewerPrincipalId: BOB, initial: "none" })))
      .toContain("Your routines are paused until you allow them to act in your name.");
    expect(renderToStaticMarkup(createElement(RoutineDelegationBanner, { routines: [routine], viewerPrincipalId: BOB, initial: "active" }))).toBe("");
    expect(renderToStaticMarkup(createElement(RoutineDelegationBanner, { routines: [routine], viewerPrincipalId: OWNER, initial: "none" }))).toBe("");
  });
});
