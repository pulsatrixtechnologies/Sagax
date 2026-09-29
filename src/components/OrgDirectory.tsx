import { useState, type FormEvent, type ReactNode } from "react";
import type { OrgRole } from "../../server/org-directory.ts";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";
import { OrgCreateForm, orgHostFromInput } from "./OrgCreateForm";

export type OrgPersonView = { id: string; role: OrgRole; email?: string };
export type PendingInviteView = { email: string; token?: string; link?: string; expiresAt?: number };

const inputClass = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent/50";

/** A person by email; a principal without one by a short id. */
export function personLabel(person: OrgPersonView): string {
  if (person.email) return person.email;
  return person.id.length > 12 ? `${person.id.slice(0, 11)}…` : person.id;
}

function roleLabel(role: OrgRole): string {
  return t(role === "owner" ? "org.role.owner" : role === "admin" ? "org.role.admin" : "org.role.member");
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ui-button"
      onClick={() => {
        void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false));
      }}
    >
      {copied ? t("org.copied") : t("org.copyLink")}
    </button>
  );
}

export function OrgDirectory({
  org,
  people,
  pendingInvites = [],
  initialAddress = "",
  canManage = true,
  lastInvite = null,
  onCreate,
  onInvite,
  onRevoke,
  onUpdateHost,
  domainSettings = null,
}: {
  org: { name: string; host?: { kind: "this-computer" } | { kind: "server"; url: string } } | null;
  people: OrgPersonView[];
  pendingInvites?: PendingInviteView[];
  initialAddress?: string;
  /** Owners and admins invite, revoke and edit the address, and see the
   * people list; a member sees only the organization's name, address and
   * status. */
  canManage?: boolean;
  /** The invite just issued, so its link can be copied at once. */
  lastInvite?: { email: string; link?: string } | null;
  onCreate: (name: string, host: { kind: "server"; url: string }) => void;
  onInvite: (email: string) => void | Promise<void>;
  onRevoke?: (token: string) => void | Promise<void>;
  onUpdateHost?: (host: { kind: "server"; url: string }) => void | Promise<void>;
  /** The server's custom-domain card, shown under the address for owners
   * and admins only. */
  domainSettings?: ReactNode;
}) {
  const [email, setEmail] = useState("");
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");

  if (!org) {
    return (
      <Card>
        <OrgCreateForm initialAddress={initialAddress} onCreate={onCreate} />
      </Card>
    );
  }

  const currentAddress = org.host?.kind === "server" ? org.host.url : "";
  const nextHost = orgHostFromInput(address);

  return (
    <Card>
      <div className="text-[15px] font-medium text-ink">{org.name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-secondary">
        <span>{t("org.serverAddress")}:</span>
        <span className="break-all text-ink">{currentAddress || "-"}</span>
        {canManage && onUpdateHost && !editing && (
          <button type="button" className="ui-button" onClick={() => { setAddress(currentAddress); setEditing(true); }}>
            {t("org.editAddress")}
          </button>
        )}
      </div>
      {editing && (
        <form
          className="mt-2 flex flex-col gap-2"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            if (!nextHost || !onUpdateHost) return;
            try {
              await onUpdateHost(nextHost);
              setEditing(false);
            } catch {
              // The parent shows the error; keep the draft so it can be corrected.
            }
          }}
        >
          <input
            name="org-server-address-edit"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="https://…"
            autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
            className={inputClass}
          />
          {address.trim() && !nextHost && <span className="text-[12px] text-ink-secondary">{t("org.addressInvalid")}</span>}
          <div className="flex gap-2">
            <button type="submit" disabled={!nextHost} className="ui-button ui-button-primary disabled:opacity-50">{t("org.saveAddress")}</button>
            <button type="button" className="ui-button" onClick={() => setEditing(false)}>{t("org.cancel")}</button>
          </div>
        </form>
      )}
      {canManage && domainSettings}
      {canManage && (
        <>
          <div className="mt-4 text-[13px] font-medium text-ink">{t("org.people")}</div>
          <ul className="mt-1 divide-y divide-hairline/40">
            {people.map((person) => (
              <li key={person.id} className="flex justify-between gap-2 py-2 text-[13px] text-ink">
                <span className="break-all" title={person.id}>{personLabel(person)}</span>
                <span className="shrink-0 text-ink-secondary">{roleLabel(person.role)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {canManage && pendingInvites.length > 0 && (
        <div className="mt-4">
          <div className="text-[13px] font-medium text-ink">{t("org.pendingInvites")}</div>
          <ul className="mt-1 divide-y divide-hairline/40">
            {pendingInvites.map((invite) => (
              <li key={invite.token ?? invite.email} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[13px] text-ink-secondary">
                <span className="break-all">{invite.email}</span>
                {canManage && (invite.link || (invite.token && onRevoke)) && (
                  <span className="flex gap-2">
                    {invite.link && <CopyLinkButton link={invite.link} />}
                    {invite.token && onRevoke && (
                      <button type="button" className="ui-button" onClick={() => void onRevoke(invite.token!)}>{t("org.revoke")}</button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-ink-secondary">{t("org.pendingHint")}</p>
        </div>
      )}
      {canManage && lastInvite?.link && (
        <div role="status" className="mt-4 rounded-lg border-[0.5px] border-border bg-elevated p-3">
          <p className="text-[13px] text-ink">{t("org.inviteLinkReady", { email: lastInvite.email })}</p>
          <code dir="ltr" className="mt-2 block select-all break-all text-[12px] text-ink-secondary">{lastInvite.link}</code>
          <div className="mt-2"><CopyLinkButton link={lastInvite.link} /></div>
        </div>
      )}
      {canManage && (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            const value = email.trim();
            if (!value) return;
            try {
              await onInvite(value);
              setEmail("");
            } catch {
              // Keep the address so a refused invite can be corrected.
            }
          }}
        >
          <label className="flex flex-col gap-1.5 text-[13px] text-ink">
            {t("org.inviteEmail")}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </label>
          <button type="submit" className="ui-button w-fit">
            {t("org.invite")}
          </button>
        </form>
      )}
    </Card>
  );
}
