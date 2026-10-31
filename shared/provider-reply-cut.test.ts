import { describe, expect, it } from "vitest";
import {
  isProviderReplyCut,
  providerReplyCutMessage,
  providerReplyCutOf,
  providerReplyCutReason,
} from "./provider-reply-cut.ts";

describe("providerReplyCutReason", () => {
  it("keeps length and content_filter, and ignores a normal stop", () => {
    expect(providerReplyCutReason("length")).toBe("length");
    expect(providerReplyCutReason("content_filter")).toBe("content_filter");
    expect(providerReplyCutReason("stop")).toBeNull();
    expect(providerReplyCutReason("tool_calls")).toBeNull();
    expect(providerReplyCutReason(null)).toBeNull();
  });
});

describe("providerReplyCutMessage", () => {
  it("stores one English sentence per cut, never a raw finish_reason", () => {
    expect(providerReplyCutMessage("length")).toBe(
      "The reply was cut: maximum length reached. Ask for a continuation.",
    );
    expect(providerReplyCutMessage("content_filter")).toBe(
      "The reply was cut by the provider: content filter.",
    );
    expect(providerReplyCutMessage("generic")).toBe("The reply was cut by the provider.");
    expect(providerReplyCutMessage("length")).not.toMatch(/provider did not finish|—|–/);
  });
});

describe("providerReplyCutOf", () => {
  it("reads the stored sentences and the pre-fix technical line", () => {
    expect(providerReplyCutOf(providerReplyCutMessage("length"))).toBe("length");
    expect(providerReplyCutOf(providerReplyCutMessage("content_filter"))).toBe("content_filter");
    expect(providerReplyCutOf("provider did not finish the response (content_filter)")).toBe("content_filter");
    expect(providerReplyCutOf("provider did not finish the response (length)")).toBe("length");
    expect(providerReplyCutOf("provider did not finish the response (max_output_tokens)")).toBe("length");
    expect(providerReplyCutOf("provider did not finish the response (incomplete)")).toBe("generic");
    expect(providerReplyCutOf("rate limited")).toBeNull();
  });

  it("isProviderReplyCut matches both shapes", () => {
    expect(isProviderReplyCut(providerReplyCutMessage("content_filter"))).toBe(true);
    expect(isProviderReplyCut("provider did not finish the response (length)")).toBe(true);
    expect(isProviderReplyCut("Something else failed.")).toBe(false);
  });
});
