import { publicText, type RemoteSessionView } from "../../../shared/remote-session";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useStore } from "@/state/store";
import { RemoteSessionActions } from "./RemoteSessionActions";
import { RemoteSessionFacts } from "./RemoteSessionFacts";
import { takeRemoteControl } from "./RemoteSessionsSection";

const SUGGESTION_LABEL: Record<string, LocaleKey> = {
  "disk-critical": "remoteSession.suggest.disk-critical",
  "disk-low": "remoteSession.suggest.disk-low",
  "ram-low": "remoteSession.suggest.ram-low",
  rights: "remoteSession.suggest.rights",
  cpu: "remoteSession.suggest.cpu",
  errors: "remoteSession.suggest.errors",
  startup: "remoteSession.suggest.startup",
};

const SUGGESTION_PROMPT: Record<string, LocaleKey> = {
  "disk-critical": "remoteSession.prompt.disk-critical",
  "disk-low": "remoteSession.prompt.disk-low",
  "ram-low": "remoteSession.prompt.ram-low",
  rights: "remoteSession.prompt.rights",
  cpu: "remoteSession.prompt.cpu",
  errors: "remoteSession.prompt.errors",
  startup: "remoteSession.prompt.startup",
};

/** The short prompt a suggestion chip sends. Unknown ids send nothing. */
export function remoteSuggestionText(id: string, host: string): string | null {
  const key = SUGGESTION_PROMPT[id];
  return key ? t(key, { host }) : null;
}

/** The chat card for one remote computer. Suggestions send a short prompt. */
export function RemoteSessionCard({ botId, threadId, view }: { botId: string; threadId: string; view: RemoteSessionView }) {
  const { dispatch } = useStore();
  const host = publicText(view.hostname) || view.code;
  const ask = (id: string) => {
    const text = remoteSuggestionText(id, host);
    if (!text) return;
    dispatch({ type: "send", botId, threadId, text });
  };
  return (
    <div data-remote-session-card="" data-remote-state={view.state} className="overflow-hidden rounded-xl border border-hairline text-ink">
      <RemoteSessionFacts view={view} />
      {view.state === "connected" && view.suggestions.length > 0 && (
        <div className="border-t border-hairline/40 px-3 py-3">
          <div className="mb-2 text-[12px] text-ink-secondary">{t("remoteSession.hints")}</div>
          <div className="flex flex-wrap gap-1.5">
            {view.suggestions.map((hint) => (
              <button
                key={hint.id}
                type="button"
                data-remote-hint={hint.id}
                onClick={() => ask(hint.id)}
                className="rounded-full border border-hairline/50 px-2.5 py-1 text-[12px] text-ink hover:bg-raised"
              >
                {t(SUGGESTION_LABEL[hint.id] ?? "remoteSession.hints")}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="border-t border-hairline/40">
        <RemoteSessionActions
          botId={botId}
          view={view}
          onTakeControl={() => takeRemoteControl(botId, view.id, () => dispatch({ type: "toggleComputer", open: true }))}
        />
      </div>
    </div>
  );
}
