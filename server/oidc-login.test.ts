// Configuration and role mapping of "Sign in with Pulsatrix" (the routes
// themselves are proven through the real server in oidc-login.e2e.test.ts).
import { describe, expect, it } from "vitest";

import { identityConfigFromEnv, identityDescriptor, isInterimSignInRoute, orgRoleForRole, scopesForRole } from "./oidc-login.ts";

describe("OMB_IDENTITY", () => {
  it("is solo unless set to perspicax", () => {
    expect(identityConfigFromEnv({})).toEqual({ kind: "solo" });
    expect(identityConfigFromEnv({ OMB_IDENTITY: "solo" })).toEqual({ kind: "solo" });
    expect(identityDescriptor({ kind: "solo" })).toBeUndefined();
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "okta" })).toThrow(/not supported/);
  });

  it("derives the redirect URI from the public origin and defaults the client id", () => {
    const config = identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "https://px.example.test/", OMB_PUBLIC_URL: "https://bot.example.test/" });
    expect(config).toEqual({ kind: "perspicax", issuer: "https://px.example.test", clientId: "pulsa-bot", publicOrigin: "https://bot.example.test", redirectUri: "https://bot.example.test/auth/oidc/callback" });
    expect(identityDescriptor(config)).toEqual({ kind: "perspicax", protocol: "oidc", issuer: "https://px.example.test", loginPath: "/auth/oidc/start" });
    expect(identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "http://localhost:18787", OMB_PUBLIC_URL: "http://localhost:18788", OMB_OIDC_CLIENT_ID: "other" }))
      .toMatchObject({ clientId: "other", redirectUri: "http://localhost:18788/auth/oidc/callback" });
  });

  it("refuses to start half configured or over plain http off this machine", () => {
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PUBLIC_URL: "https://bot.example.test" })).toThrow(/OMB_PERSPICAX_ISSUER/);
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "http://px.example.test", OMB_PUBLIC_URL: "https://bot.example.test" })).toThrow(/OMB_PERSPICAX_ISSUER/);
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "https://px.example.test" })).toThrow(/OMB_PUBLIC_URL/);
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "https://px.example.test", OMB_PUBLIC_URL: "http://bot.example.test" })).toThrow(/OMB_PUBLIC_URL/);
    expect(() => identityConfigFromEnv({ OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: "https://px.example.test", OMB_PUBLIC_URL: "https://bot.example.test/app" })).toThrow(/OMB_PUBLIC_URL/);
  });
});

describe("the role claim", () => {
  it("maps admin to admin scopes, manager and employee (or no claim) to client, anything else to nothing", () => {
    expect(scopesForRole("admin")).toEqual(["admin", "client"]);
    expect(orgRoleForRole("admin")).toBe("admin");
    for (const role of ["manager", "employee", undefined]) {
      expect(scopesForRole(role)).toEqual(["client"]);
      expect(orgRoleForRole(role)).toBe("member");
    }
    expect(scopesForRole("service")).toBeNull();
    expect(orgRoleForRole("owner")).toBeNull();
  });
});

describe("interim sign-in routes on an organization server", () => {
  it("covers email codes and every invitation path, nothing else", () => {
    expect(isInterimSignInRoute("POST", "/api/auth/email/start")).toBe(true);
    expect(isInterimSignInRoute("POST", "/api/auth/email/verify")).toBe(true);
    expect(isInterimSignInRoute("POST", "/api/org/invites")).toBe(true);
    expect(isInterimSignInRoute("GET", "/api/org/invites/abc/preview")).toBe(true);
    expect(isInterimSignInRoute("POST", "/api/org/invites/abc/join")).toBe(true);
    expect(isInterimSignInRoute("GET", "/api/org")).toBe(false);
    expect(isInterimSignInRoute("POST", "/api/auth/pair")).toBe(false);
    expect(isInterimSignInRoute("GET", "/api/org/invitesx")).toBe(false);
  });
});
