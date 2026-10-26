import { describe, expect, it } from "vitest";

import { teamSetupErrorMessage } from "./team-setup-error-text";
import en from "../locales/en.json" with { type: "json" };
import fr from "../locales/fr.json" with { type: "json" };

describe("Apply setup refusals in the app's language (#1058)", () => {
  it("reads the server's code, never its English sentence", () => {
    expect(teamSetupErrorMessage({ code: "team_setup_admin_required", error: "x" })).toBe(en["teamSetup.error.adminRequired"]);
    expect(teamSetupErrorMessage({ code: "team_setup_desktop_only", error: "x" })).toBe(en["teamSetup.error.desktopOnly"]);
    expect(teamSetupErrorMessage({ error: "other" })).toBeNull();
    expect(fr["teamSetup.error.adminRequired"]).toContain("administrateur");
  });
});
