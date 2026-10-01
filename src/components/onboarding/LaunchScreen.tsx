// The launch screen: the desktop app's first question, before the welcome
// tour. "No server" (or Escape) is the solo, local-first app; the tour
// follows. "Server" checks that the address is a Sagax server that signs
// people in with Pulsatrix (the same probe "Join a Perspicax server" uses),
// remembers the choice, then saves that server, locks the app to it (server
// mode: no Local, no other server) and starts its own "Sign in with
// Pulsatrix" (electron/org-join.mjs join). No new sign-in path: the server
// is the OIDC client and the desktop only opens it.
//
// The card is the welcome flow's card, so the two read as one surface.
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Laptop, Server } from "lucide-react";
import { MausAvatar } from "@/components/Avatar";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { defaultServerAddress, launchErrorKey, launchModePatch, type LaunchBridges, type LaunchMode } from "@/lib/launch";
import { serverAddress } from "@/lib/org-join";
import { readPreferences } from "@/lib/user-preferences-sync";
import { api, useStore } from "@/state/store";
import { inputClass, PrimaryButton } from "./beats/shared";

function localStorageOrNull(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}

export function LaunchScreen({
  bridges,
  onSolo,
  initialMode = "solo",
}: {
  bridges: LaunchBridges;
  /** No server, or Escape: the app goes on (the tour, or back to where it was). */
  onSolo: () => void;
  initialMode?: LaunchMode;
}) {
  const { dispatch } = useStore();
  const [mode, setMode] = useState<LaunchMode>(initialMode);
  const [address, setAddress] = useState(() => defaultServerAddress());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  const remember = async (choice: LaunchMode) => {
    try {
      const config = await api("/api/config", { method: "PUT", body: JSON.stringify(launchModePatch(choice)), signal: AbortSignal.timeout(10_000) });
      dispatch({ type: "configStatus", config });
    } catch {
      // Offline: the screen comes back next launch, which is the honest state.
    }
  };

  const solo = () => {
    if (pending.current) return;
    // The app must never wait on the save to go on.
    onSolo();
    void remember("solo");
  };

  const connect = async () => {
    if (pending.current) return;
    const origin = serverAddress(address);
    if (!origin) {
      setError(t("launch.error.address"));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const probed = await bridges.orgJoin.probe(origin);
      await remember("server");
      // The window leaves for the server's sign-in from here.
      // This computer's preferences go along, once: the server keeps them for
      // the person on first sign-in (src/lib/user-preferences-sync.ts). The
      // local copy stays as it is for No server.
      await bridges.orgJoin.join({ origin: probed.origin, serverMode: true, preferences: readPreferences(localStorageOrNull()) });
    } catch (failure) {
      setError(t(launchErrorKey(failure)));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      solo();
    }
  };

  const app = brand().name;
  const logo = brand().logo;
  const option = (id: LaunchMode, Icon: typeof Laptop, title: string, body: string) => (
    <button
      type="button"
      data-mode={id}
      aria-pressed={mode === id}
      disabled={busy}
      onClick={() => {
        setMode(id);
        setError("");
      }}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border bg-card px-3.5 py-3 text-start transition-colors disabled:opacity-60",
        mode === id ? "border-accent" : "border-hairline/40 hover:border-hairline",
      )}
    >
      <Icon size={18} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] font-medium text-ink">{title}</span>
        <span className="text-[12.5px] leading-snug text-ink-secondary">{body}</span>
      </span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app p-3 sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("launch.dialog")}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="welcome-card relative flex max-h-full w-full flex-col overflow-y-auto rounded-2xl border border-hairline/40 bg-panel p-5 sm:p-8 shadow-[0_30px_80px_-28px_rgba(0,0,0,0.45),0_8px_24px_-12px_rgba(0,0,0,0.25)] outline-none"
        style={{ maxWidth: 460 }}
      >
        <div className="flex shrink-0 flex-col items-center">
          <div className="welcome-maus flex shrink-0">
            {logo ? (
              <img src={logo} alt="" width={72} height={72} className="h-[72px] w-[72px] object-contain" />
            ) : (
              <MausAvatar color="green" state="happy" size={72} label={app} />
            )}
          </div>
          <h1 className="welcome-title mt-4 text-[20px] font-semibold text-ink">{t("launch.title", { app })}</h1>
          <p className="animate-rise mt-1 text-center text-[13.5px] text-ink-secondary">{t("launch.intro", { app })}</p>
        </div>

        <form
          className="mt-5 flex shrink-0 flex-col gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "solo") solo();
            else void connect();
          }}
        >
          {option("solo", Laptop, t("launch.solo.title"), t("launch.solo.body"))}
          {option("server", Server, t("launch.server.title"), t("launch.server.body", { app }))}
          {mode === "server" && (
            <label className="animate-rise mt-1 flex flex-col gap-1.5 text-[12px] text-ink-secondary">
              {t("launch.server.address")}
              <input
                type="url"
                value={address}
                disabled={busy}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setError("");
                }}
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                dir="ltr"
                className={inputClass}
              />
            </label>
          )}
          {error && <p role="alert" className="text-[12.5px] text-danger">{error}</p>}
          <PrimaryButton type="submit" disabled={busy || (mode === "server" && !address.trim())} className="mt-2">
            {mode === "solo" ? t("launch.continue") : busy ? t("launch.working") : t("launch.signIn")}
          </PrimaryButton>
          <p className="text-center text-[11.5px] text-ink-secondary">{t("launch.later")}</p>
        </form>
      </div>
    </div>
  );
}
