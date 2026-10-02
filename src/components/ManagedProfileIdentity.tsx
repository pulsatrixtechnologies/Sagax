// The signed-in person's name and email on an organization server, read-only:
// Pulsatrix Perspicax owns them (src/lib/profile-management.ts), so there is
// no field to type in, only the note saying so and a link to the issuer
// console's own profile page, with the Perspicax avatar when there is one.
// Settings > General and the welcome flow's greeting both show it.
import { ExternalLink } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import type { ManagedProfile } from "@/lib/profile-management";
import { InitialsAvatar } from "./Avatar";
import { profileInitials, profileLabel } from "./SidebarProfileMenu";

/** `flat`: inside a settings card, which already draws the border. */
export function ManagedProfileIdentity({ profile, className = "", flat = false }: { profile: ManagedProfile; className?: string; flat?: boolean }) {
  const { name, email, url, avatarUrl } = profile;
  const frame = flat ? "" : "rounded-[14px] border-[0.5px] border-border px-3.5 py-2.5";
  return (
    <div className={`flex items-center gap-3 text-left ${frame} ${className}`} data-testid="managed-profile">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" width={36} height={36} className="size-9 shrink-0 rounded-full object-cover" />
      ) : (
        <InitialsAvatar initials={profileInitials({ name, email })} size={36} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">{profileLabel({ name, email })}</div>
        {email && <div className="mt-0.5 truncate text-[13px] text-ink-secondary">{email}</div>}
        <div className="mt-0.5 text-[12px] text-ink-secondary">{t("settings.profile.managedByOrg")}</div>
        {url && (
          <button
            type="button"
            onClick={() => void openExternalLink(url)}
            className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
          >
            {t("settings.profile.editInPerspicax")}
            <ExternalLink size={12} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
