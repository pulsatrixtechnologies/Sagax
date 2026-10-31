// A provider stopped a reply short (OpenAI finish_reason / Responses
// incomplete_details): content filter or output length. The server stores
// these English sentences on the failed-turn row; the app says them again
// in the reader's language (src/lib/plain-error.ts) and does not offer Retry
// (the same cut would happen again).

export type ProviderReplyCut = "length" | "content_filter";

const LENGTH = "The reply was cut: maximum length reached. Ask for a continuation.";
const FILTER = "The reply was cut by the provider: content filter.";
const GENERIC = "The reply was cut by the provider.";

/** The old driver line, still stored on turns that failed before this fix. */
const LEGACY = /^provider did not finish the response \((.+)\)$/i;

export function providerReplyCutReason(finishReason: string | null | undefined): ProviderReplyCut | null {
  if (finishReason === "length" || finishReason === "content_filter") return finishReason;
  return null;
}

export function providerReplyCutMessage(reason: ProviderReplyCut | "generic" = "generic"): string {
  if (reason === "length") return LENGTH;
  if (reason === "content_filter") return FILTER;
  return GENERIC;
}

/** Which cut a stored cause names, including the pre-fix technical line. */
export function providerReplyCutOf(cause: string): ProviderReplyCut | "generic" | null {
  const text = cause.trim();
  if (text === LENGTH) return "length";
  if (text === FILTER) return "content_filter";
  if (text === GENERIC) return "generic";
  const legacy = LEGACY.exec(text)?.[1]?.trim().toLowerCase();
  if (!legacy) return null;
  if (legacy === "length" || legacy === "max_output_tokens") return "length";
  if (legacy === "content_filter") return "content_filter";
  return "generic";
}

export function isProviderReplyCut(cause: string): boolean {
  return providerReplyCutOf(cause) !== null;
}
