// The desktop's native "Sign in with your organization" entry (menu item,
// openmausbot://organization, ?desktop-settings=organization) asks for the
// enterprise Admin connection by name. Settings hides that card otherwise,
// unless a connection exists or the app is managed; this remembers the ask
// for the rest of the window's life.
let requested = false;

export function requestEnterpriseEntry(): void {
  requested = true;
}

export function enterpriseEntryRequested(): boolean {
  return requested;
}

/** Tests only. */
export function resetEnterpriseEntry(): void {
  requested = false;
}
