import { describe, expect, it } from "vitest";

import { checkAgainHours, orderStepIndex, parseTracking, parseUpdateTrackingCall, trackingLine, ORDER_CHECK_HOURS } from "./order-tracking.ts";
import { parseReceiptCall } from "./payment-vault.ts";

describe("order tracking", () => {
  it("reads a tracking object and refuses what a card cannot show", () => {
    expect(parseTracking(undefined)).toBeUndefined();
    expect(parseTracking({ step: "shipped", carrier: " Canada  Post ", number: "LM 123 456 789 CA", url: "https://track.example/LM123", eta: "2026-11-02", note: "Signature needed" }))
      .toEqual({ step: "shipped", carrier: "Canada Post", number: "LM123456789CA", url: "https://track.example/LM123", eta: "2026-11-02", note: "Signature needed" });
    expect(parseTracking({ carrier: "UPS" }, "ordered")).toEqual({ step: "ordered", carrier: "UPS" });
    expect(parseTracking({ step: "teleported" })).toMatch(/^tracking\.step: one of ordered/);
    expect(parseTracking({ step: "shipped", url: "javascript:alert(1)" })).toBe("tracking.url: the tracking page, an http or https address.");
    expect(parseTracking({ step: "shipped", eta: "2026-02-30" })).toBe("tracking.eta: the expected day, YYYY-MM-DD.");
  });

  it("places in transit with shipped and a problem off the bar", () => {
    expect(orderStepIndex("ordered")).toBe(0);
    expect(orderStepIndex("in_transit")).toBe(1);
    expect(orderStepIndex("delivered")).toBe(3);
    expect(orderStepIndex("exception")).toBe(-1);
  });

  it("bounds the next check", () => {
    expect(checkAgainHours(undefined)).toBe(ORDER_CHECK_HOURS.default);
    expect(checkAgainHours(0)).toBe(ORDER_CHECK_HOURS.min);
    expect(checkAgainHours("500")).toBe(ORDER_CHECK_HOURS.max);
  });

  it("parses update_order_tracking and record_purchase's tracking", () => {
    expect(parseUpdateTrackingCall({ arguments: { order_ref: "A-1", step: "out_for_delivery", check_again_hours: 4 } }))
      .toEqual({ orderRef: "A-1", tracking: { step: "out_for_delivery" }, checkAgainHours: 4 });
    expect(parseUpdateTrackingCall({ arguments: {} })).toBe("update_order_tracking needs step.");
    expect(parseUpdateTrackingCall({ arguments: { step: "nowhere" } })).toMatch(/^step: one of/);
    expect(parseReceiptCall({ arguments: { order_ref: "A-1", tracking: { carrier: "UPS", number: "1Z999" } } }))
      .toEqual({ orderRef: "A-1", tracking: { step: "ordered", carrier: "UPS", number: "1Z999" } });
  });

  it("says where the parcel is in one line", () => {
    expect(trackingLine({ step: "shipped", carrier: "UPS", number: "1Z999", eta: "2026-11-02", updatedAt: 1 })).toBe("Shipped, UPS 1Z999, expected 2026-11-02");
    expect(trackingLine({ step: "delivered", eta: "2026-11-02", note: "Front door", updatedAt: 1 })).toBe("Delivered, Front door");
  });
});
