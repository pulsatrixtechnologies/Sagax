import { describe, expect, it } from "vitest";

import { meetingRequestBehavior } from "../../shared/meeting-request";
import { meetingCanLeave, meetingStatusLabel } from "./MeetingCard";

describe("MeetingCard", () => {
  it("offers Leave only while the bot is in or on its way in", () => {
    expect(meetingCanLeave({ status: "pending" })).toBe(false);
    expect(meetingCanLeave({ status: "joining" })).toBe(true);
    expect(meetingCanLeave({ status: "waiting" })).toBe(true);
    expect(meetingCanLeave({ status: "recording" })).toBe(true);
    expect(meetingCanLeave({ status: "ending" })).toBe(false);
    expect(meetingCanLeave({ status: "ended" })).toBe(false);
  });

  it("labels every status", () => {
    for (const status of ["pending", "joining", "waiting", "announcing", "recording", "ending", "ended", "declined", "failed"] as const) {
      expect(meetingStatusLabel(status)).toBeTruthy();
    }
  });

  it("maps only the approve label to allow", () => {
    expect(meetingRequestBehavior("Join and take notes")).toBe("allow");
    expect(meetingRequestBehavior("Rejoindre et prendre des notes")).toBe("allow");
    expect(meetingRequestBehavior("Not this time")).toBe("deny");
    expect(meetingRequestBehavior("yes")).toBe("deny");
  });
});
