type Store = Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;

const LEGACY_KEY = "omb-webhook-credentials";

/** Earlier builds kept every private webhook URL (secret included) in local
 * browser storage. A bearer token is shown once and never stored here, so
 * whatever an older build left behind is deleted. */
export function purgeStoredWebhookCredentials(store: Store): void {
  try {
    store?.removeItem(LEGACY_KEY);
  } catch {
    // Nothing to clean when storage is blocked.
  }
}

export function webhookCredentialStore(): Store {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
