// Inline setup for connected apps when no connection service is configured.
// Connected apps run through the workspace's own Composio project: the owner
// pastes a project API key here, the server validates it against Composio
// before storing it (PUT /api/config), and the marketplace reloads in place.
// Members and remote clients cannot change workspace credentials, so they
// only see who to ask.
import { ExternalLink, PlugZap } from "lucide-react";
import { ApiKeyRow } from "./ApiKeys";
import { t } from "@/lib/i18n";

export const COMPOSIO_PLATFORM_URL = "https://platform.composio.dev";

export function ConnectedAppsSetup({
  canConfigure,
  onConfigured,
}: {
  /** owner or admin on this workspace's own server; null while unknown */
  canConfigure: boolean | null;
  onConfigured: () => void;
}) {
  return (
    <section
      aria-labelledby="connected-apps-setup-title"
      className="mx-6 mb-1 rounded-xl border border-border bg-inset px-4 py-3.5 sm:mx-8"
    >
      <div className="flex items-start gap-3">
        <PlugZap size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="connected-apps-setup-title" className="text-[13.5px] font-medium text-ink">
            {t("connectors.setup.title")}
          </h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
            {t("connectors.setup.body")}
          </p>
          {canConfigure === true ? (
            <>
              <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-[12.5px] leading-relaxed text-ink-secondary">
                <li>
                  {t("connectors.setup.step1")}{" "}
                  <a
                    href={COMPOSIO_PLATFORM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                  >
                    platform.composio.dev
                    <ExternalLink size={11} aria-hidden="true" />
                  </a>
                </li>
                <li>{t("connectors.setup.step2")}</li>
                <li>{t("connectors.setup.step3")}</li>
              </ol>
              <div className="mt-3">
                <ApiKeyRow section="composio" onSaved={(configured) => configured && onConfigured()} />
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-tertiary">{t("connectors.setup.storage")}</p>
            </>
          ) : canConfigure === false ? (
            <p className="mt-2 text-[12.5px] font-medium text-ink">{t("connectors.setup.askOwner")}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
