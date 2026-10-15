// Settings > General: one card for the account (2026-10-15, was a "Server"
// card plus a collapsible "Profile" card that repeated the name and email).
//
//   [avatar]  Name
//             Add a label  (pencil: edited in place)
//             email                                  [Sign out]
//             Managed by your organization
//             Edit in Perspicax
//   Your bots run on this server. Sign out returns this app to ...
//
// On an organization server (Pulsatrix Perspicax) the name, email and avatar
// are Perspicax's and read-only; the server and the organization stay one
// hover away, on "Managed by your organization". On a personal server the
// operator edits name, email and photo here; the label stays; the action is
// the desktop's server switcher instead of Sign out, and the help line speaks
// of the local installation. Sign out is the desktop's server mode bridge
// (src/lib/launch.ts): it asks natively, signs out and returns to the launch
// screen, unchanged.
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Cloud, ExternalLink, Laptop, LogOut } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { serverModeBridge } from "@/lib/launch";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { managedProfile } from "@/lib/profile-management";
import { useStore, type ConfigStatus } from "@/state/store";
import { InitialsAvatar } from "../Avatar";
import { useDesktopWorkspace } from "../DesktopWorkspaceSwitcher";
import type { ServerModeState } from "../ServerModeSettings";
import { profileInitials, profileLabel } from "../SidebarProfileMenu";
import { MyLabelField } from "./MyLabelField";

type LockedServer = Extract<ServerModeState, { active: true }>;

function host(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** "Connected to <b>host</b>" with the address in bold, in any word order. */
function ConnectedTo({ server }: { server: string }) {
  const [before, after = ""] = t("settings.serverMode.connectedTo", { server: "\u0000" }).split("\u0000");
  return <>{before}<strong className="font-semibold text-ink">{server}</strong>{after}</>;
}

/** Where this account lives, for the tooltip of "Managed by your
 * organization": the server's address and the organization's name. */
export function accountServerDetails(input: { origin?: string | null; organization?: string | null }): string {
  const parts: string[] = [];
  if (input.origin) parts.push(t("settings.serverMode.connectedTo", { server: host(input.origin) }));
  const organization = input.organization?.trim();
  if (organization) parts.push(t("settings.serverMode.organization", { name: organization }));
  return parts.join(" · ");
}

export function AccountCard({ lockedServer }: { lockedServer: LockedServer | null }) {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const viewer = state.config?.viewer;
  const managed = managedProfile(viewer);
  const operator = !managed && !(viewer && !viewer.operator);
  const organization = (org?.org.name || lockedServer?.name || "").trim();
  const [signOutFailed, setSignOutFailed] = useState(false);
  const workspace = useDesktopWorkspace();
  const switcher = !lockedServer && workspace.available;

  const action = lockedServer
    ? <SignOutButton onFailed={setSignOutFailed} />
    : switcher ? <ServerSwitchButton workspace={workspace} /> : null;

  const help = lockedServer
    ? t("settings.serverMode.signOutHelp")
    : switcher
      ? (workspace.current?.local === false && workspace.current.origin) || t("settings.launch.solo")
      : null;
  const details = accountServerDetails({ origin: lockedServer?.origin, organization });

  return (
    <div
      role="group"
      aria-label={t("settings.profile.title")}
      data-settings-card="general.account"
      className="rounded-[14px] border-[0.5px] border-border px-3.5 py-3"
    >
      {operator
        ? <OperatorIdentity action={action} />
        : (
          <ReadOnlyIdentity
            name={managed?.name || viewer?.name || ""}
            email={managed?.email || viewer?.email || ""}
            avatarUrl={managed?.avatarUrl}
            action={action}
          >
            {managed ? (
              <>
                <div className="mt-0.5 text-[12px] text-ink-secondary" title={details || undefined} data-account-managed="">
                  {t("settings.serverMode.managedShort")}
                </div>
                {managed.url && (
                  <button
                    type="button"
                    onClick={() => void openExternalLink(managed.url!)}
                    className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
                  >
                    {t("settings.profile.editInPerspicax")}
                    <ExternalLink size={12} aria-hidden="true" />
                  </button>
                )}
              </>
            ) : !lockedServer && (
              <div className="mt-0.5 text-[12px] text-ink-secondary">{t("settings.profile.signedInAs")}</div>
            )}
          </ReadOnlyIdentity>
        )}
      {help && (
        <p className="mt-3 text-[12.5px] leading-[18px] text-ink-secondary" data-account-help="">
          {help}
          {lockedServer && !managed && (
            <span data-server-connected className="mt-0.5 block text-[12px]"><ConnectedTo server={host(lockedServer.origin)} /></span>
          )}
        </p>
      )}
      {signOutFailed && <p role="alert" className="mt-2 text-[12px] text-danger">{t("settings.serverMode.signOutFailed")}</p>}
      {workspace.error && <p role="alert" className="mt-2 text-[12px] text-danger">{workspace.error}</p>}
    </div>
  );
}

/** The email line with the card's action at its right. */
function EmailRow({ children, action }: { children: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="mt-0.5 flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function ReadOnlyIdentity({ name, email, avatarUrl, action, children }: {
  name: string;
  email: string;
  avatarUrl?: string;
  action: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-left" data-testid="account-identity">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" width={36} height={36} className="size-9 shrink-0 rounded-full object-cover" />
      ) : (
        <InitialsAvatar initials={profileInitials({ name, email })} size={36} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">{profileLabel({ name, email })}</div>
        <MyLabelField />
        <EmailRow action={action}>
          {email && <div className="truncate text-[13px] text-ink-secondary">{email}</div>}
        </EmailRow>
        {children}
      </div>
    </div>
  );
}

/** Sign out of the organization server: the desktop asks for confirmation,
 * signs out and leaves this page. */
function SignOutButton({ onFailed }: { onFailed: (failed: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const leave = () => {
    const bridge = serverModeBridge(window.ogb);
    if (!bridge || busy) return;
    setBusy(true);
    onFailed(false);
    void bridge.leave().catch(() => onFailed(true)).finally(() => setBusy(false));
  };
  return (
    <button type="button" onClick={leave} disabled={busy} className="ui-button inline-flex items-center gap-1.5">
      <LogOut size={13} aria-hidden="true" />
      {t("settings.serverMode.signOut")}
    </button>
  );
}

/** The desktop's own server list (native menu), on this computer's page. */
function ServerSwitchButton({ workspace }: { workspace: ReturnType<typeof useDesktopWorkspace> }) {
  const name = workspace.current?.name ?? t("settings.thisComputer.title");
  const Icon = workspace.current?.local === false ? Cloud : Laptop;
  return (
    <button
      type="button"
      aria-label={t("settings.thisComputer.switch", { name })}
      aria-haspopup="menu"
      aria-expanded={workspace.open}
      onClick={workspace.openMenu}
      className="ui-button inline-flex max-w-[200px] items-center gap-1.5"
    >
      <Icon size={13} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">{name}</span>
      <ChevronDown size={12} aria-hidden="true" className="shrink-0" />
    </button>
  );
}

function profilePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(t("settings.profile.photoReadError")));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(t("settings.profile.photoReadError")));
      image.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error(t("settings.profile.photoReadError")));
          return;
        }
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** The operator of a personal server: name, email and photo are this
 * server's own, saved as they are typed (PUT /api/config). */
function OperatorIdentity({ action }: { action: React.ReactNode }) {
  const { state, dispatch } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  const [avatarUrl, setAvatarUrl] = useState(state.config?.profile?.avatarUrl ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
    setAvatarUrl(state.config?.profile?.avatarUrl ?? "");
  }, [state.config?.profile?.name, state.config?.profile?.email, state.config?.profile?.avatarUrl]);

  const save = (next: { name?: string; email?: string; avatarUrl?: string } = {}) => {
    const profile = {
      name: (next.name ?? name).trim(),
      email: (next.email ?? email).trim().toLowerCase(),
      avatarUrl: next.avatarUrl ?? avatarUrl,
    };
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile }),
    })
      .then((r) => { if (!r.ok) throw new Error(t("settings.profile.photoSaveError")); return r.json(); })
      .then((config: ConfigStatus) => {
        if (config.profile) dispatch({ type: "profileSaved", profile: config.profile });
      })
      .catch(() => {});
  };

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    void profilePhoto(file).then((url) => {
      setAvatarUrl(url);
      save({ avatarUrl: url });
    }).catch(() => {});
  };

  const initials = (name.trim() || email.trim() || "?").slice(0, 1).toUpperCase();
  return (
    <div className="flex items-start gap-3" data-testid="account-identity">
      <div className="relative">
        <button
          type="button"
          aria-label={t("settings.profile.changeAvatar")}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-raised text-[13px] font-semibold text-ink"
        >
          {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : initials}
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full z-10 mt-2 flex min-w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px]">
            <button type="button" onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover">{t("settings.profile.uploadPhoto")}</button>
            {avatarUrl && <button type="button" onClick={() => { setAvatarUrl(""); setMenuOpen(false); save({ avatarUrl: "" }); }} className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover">{t("settings.profile.removePhoto")}</button>}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label={t("settings.profile.uploadAvatar")} onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      <div className="min-w-0 flex-1">
        <input aria-label={t("settings.profile.name")} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save()} placeholder={t("settings.profile.name")} className="w-full bg-transparent text-[14px] font-semibold text-ink placeholder:text-ink-secondary focus:outline-none" />
        <MyLabelField />
        <EmailRow action={action}>
          <input type="email" aria-label={t("phone.signIn.email")} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => save()} placeholder="you@example.com" className="w-full bg-transparent text-[13px] text-ink-secondary placeholder:text-ink-secondary focus:outline-none" />
        </EmailRow>
      </div>
    </div>
  );
}
