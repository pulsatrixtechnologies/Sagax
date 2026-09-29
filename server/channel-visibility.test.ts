import { describe, expect, it } from "vitest";
import {
  canSeeChannel,
  canSeeDirectBot,
  channelViewerId,
  liveFramesNeedChannelFilter,
  sseFrameProjection,
  searchHitVisible,
  seesBotForViewer,
  seesChannel,
  seesChannelFrame,
} from "./channel-visibility.ts";

describe("channel visibility", () => {
  it("hides a channel from someone who was not added", () => {
    expect(canSeeChannel({ humanIds: ["jc"], viewerId: "zachary@example.test" })).toBe(false);
    expect(canSeeChannel({ humanIds: ["jc", "zachary@example.test"], viewerId: "zachary@example.test" })).toBe(true);
  });
  it("shows another person's bot in Direct only after a grant", () => {
    expect(canSeeDirectBot({ ownerUserId: "jc", viewerId: "zachary@example.test", directGrants: [] })).toBe(false);
    expect(canSeeDirectBot({ ownerUserId: "jc", viewerId: "zachary@example.test", directGrants: ["zachary@example.test"] })).toBe(true);
    expect(canSeeDirectBot({ ownerUserId: "jc", viewerId: "jc", directGrants: [] })).toBe(true);
  });
  it("hides a channel from an admin who was not added", () => {
    const viewerId = channelViewerId({
      kind: "session",
      session: { email: "ada@example.test", principalId: "pr_ada" },
    });
    expect(seesChannel({ humanIds: ["jc"] }, viewerId)).toBe(false);
    expect(seesChannel({ humanIds: ["jc", "pr_ada"] }, viewerId)).toBe(true);
  });
  it("filters live frames for a signed-in admin and not for loopback", () => {
    expect(liveFramesNeedChannelFilter("ada@example.test")).toBe(true);
    expect(liveFramesNeedChannelFilter(undefined)).toBe(false);
  });
  it("keeps the admin projection after a channel filter allows the frame", () => {
    expect(sseFrameProjection({ admin: true })).toBe("admin");
    expect(sseFrameProjection({ admin: false })).toBe("client");
  });
  it("keeps a channel speaker visible even without a direct grant", () => {
    expect(seesChannelFrame({
      humanIds: ["jc", "zachary@example.test"],
      viewerId: "zachary@example.test",
      speakingOwnerUserId: "jc",
      speakingDirectGrants: [],
    })).toBe(true);
    expect(canSeeDirectBot({ ownerUserId: "jc", viewerId: "zachary@example.test", directGrants: [] })).toBe(false);
    expect(seesBotForViewer({
      viewerId: "zachary@example.test",
      ownerUserId: "jc",
      directGrants: [],
      inChannels: [{ humanIds: ["jc", "zachary@example.test"] }],
    })).toBe(true);
    expect(seesBotForViewer({
      viewerId: "zachary@example.test",
      ownerUserId: "jc",
      directGrants: [],
      inChannels: [{ humanIds: ["jc"] }],
    })).toBe(false);
  });
  it("hides a bot with no owner from a signed-in viewer who was not given it", () => {
    expect(seesBotForViewer({
      viewerId: "zachary@example.test",
      directGrants: [],
      inChannels: [],
    })).toBe(false);
    expect(seesBotForViewer({
      viewerId: "zachary@example.test",
      directGrants: ["Zachary@example.test"],
      inChannels: [],
    })).toBe(true);
    expect(seesBotForViewer({
      viewerId: undefined,
      directGrants: [],
      inChannels: [],
    })).toBe(true);
  });
  it("drops search hits from a channel or bot the viewer was not given", () => {
    expect(searchHitVisible({
      viewerId: "zachary@example.test",
      channel: { humanIds: ["jc"] },
      bot: null,
    })).toBe(false);
    expect(searchHitVisible({
      viewerId: "zachary@example.test",
      channel: null,
      bot: { ownerUserId: "jc", directGrants: [], inChannels: [{ humanIds: ["jc"] }] },
    })).toBe(false);
    expect(searchHitVisible({
      viewerId: "zachary@example.test",
      channel: { humanIds: ["jc", "zachary@example.test"] },
      bot: null,
    })).toBe(true);
    expect(searchHitVisible({
      viewerId: "jc",
      channel: null,
      bot: { ownerUserId: "jc", directGrants: [], inChannels: [] },
    })).toBe(true);
  });
});

describe("viewer id by principal", () => {
  it("uses the session principal", () => {
    expect(channelViewerId({ kind: "session", session: { id: "s1", email: "z@gox.ca", principalId: "pr_11111111-1111-4111-8111-111111111111" } }))
      .toBe("pr_11111111-1111-4111-8111-111111111111");
  });
  it("gives a session without a principal an id that sees no channel", () => {
    const viewer = channelViewerId({ kind: "session", session: { id: "s9" } });
    expect(viewer).toBe("anon:s9");
    expect(seesChannel({ humanIds: ["pr_11111111-1111-4111-8111-111111111111"] }, viewer)).toBe(false);
    expect(seesBotForViewer({ viewerId: viewer, ownerUserId: "pr_11111111-1111-4111-8111-111111111111", directGrants: [], inChannels: [] })).toBe(false);
  });
  it("leaves the local operator unfiltered", () => {
    expect(channelViewerId({ kind: "loopback" })).toBeUndefined();
  });
});


