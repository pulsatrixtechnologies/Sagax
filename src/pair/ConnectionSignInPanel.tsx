import { PersonAvatar } from "@/components/MessageAuthor";
import { t } from "@/lib/i18n";
import { personInitials } from "@/lib/room-authors";

/** Connection animation after Sagax Business hands a credential back to /pair. */
export function ConnectionSignInPanel({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const label = name.trim() || t("pair.connection.anonymous");
  return (
    <div className="mt-6 flex flex-col items-center text-center" data-testid="connection-sign-in" role="status" aria-live="polite">
      <div className="relative flex size-20 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/25 motion-reduce:animate-none" aria-hidden />
        <span className="absolute inset-1 rounded-full border border-accent/40 motion-reduce:hidden" aria-hidden />
        <div className="relative z-[1] rounded-full shadow-md">
          <PersonAvatar avatarUrl={avatarUrl} initials={personInitials(label)} size={72} />
        </div>
      </div>
      <p className="mt-4 text-[15px] font-medium text-ink">{label}</p>
      <p className="mt-1 text-[13.5px] text-ink-secondary">{t("pair.connection.line")}</p>
      <p className="mt-3 text-[12px] font-medium tracking-wide text-ink-tertiary uppercase">{t("pair.connection.brand")}</p>
    </div>
  );
}
