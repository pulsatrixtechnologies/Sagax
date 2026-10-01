import { useEffect, useRef, useState } from "react";
import { DesktopWorkspaceSwitcher } from "../components/DesktopWorkspaceSwitcher";
import { t } from "@/lib/i18n";

import {
  defaultDeviceLabel,
  isConnected,
  newAttemptId,
  pairWithCode,
  pulsatrixLoginPath,
  readSessionState,
  reasonWorthShowing,
  startEmailSignIn,
  takeSignInErrorFromLocation,
  verifyEmailSignIn,
  type EnvironmentDescriptor,
  type SessionState,
} from "../lib/session";

const input = "mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent-border";
const button = "mt-5 w-full rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50";
const fieldLabel = "mt-4 block text-[12px] font-medium text-ink-secondary";

/** Why "Sign in with Pulsatrix" came back here, in the reader's words. */
export function signInErrorText(code: string): string {
  if (code === "role") return t("pair.pulsatrix.errorRole");
  if (code === "rate_limited") return t("pair.pulsatrix.errorRateLimited");
  if (code === "unavailable") return t("pair.pulsatrix.errorUnavailable");
  if (code === "client") return t("pair.pulsatrix.errorClient");
  return t("pair.pulsatrix.error");
}

/** Redeem a credential the desktop app brought back from "Sign in with
 * Pulsatrix" without asking, but only when the app's main process says it
 * handed over that exact credential (a return it was waiting for). A plain
 * browser, or any page opened from a link somebody posted, gets "ask": the
 * code form, and a click. Otherwise a member could post
 * /pair#code=<their credential>&auto=1 and sign whoever opens it in as them. */
export async function finishReturnedSignIn<R>({ code, bridge, pair }: { code: string; bridge: Pick<NonNullable<Window["ogb"]>, "takeSignInReturn"> | undefined; pair: () => Promise<R> }): Promise<R | "ask"> {
  const take = bridge?.takeSignInReturn;
  if (typeof take !== "function") return "ask";
  let handed = false;
  try {
    handed = (await take(code)) === true;
  } catch {
    handed = false;
  }
  return handed ? pair() : "ask";
}

/** The page a pairing link opens: /pair#code=XXXX-XXXX-XXXX. Also what the
 * app shows instead of itself when a remote browser has no session yet.
 * When the server has a sign-in allow-list, "sign in with your email" comes
 * first and the pairing code stays one link away. */
export function PairPage({ initialCode, initialEmail = null, reason, autoSubmit = false }: { initialCode: string | null; initialEmail?: string | null; reason?: string; autoSubmit?: boolean }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [label, setLabel] = useState(defaultDeviceLabel());
  const [environment, setEnvironment] = useState<EnvironmentDescriptor | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // one id per code typed: a retry after a lost response reuses it, a new code gets a new one
  const [attemptId, setAttemptId] = useState(() => newAttemptId());
  const [mode, setMode] = useState<"pulsatrix" | "email" | "code" | null>(initialCode ? "code" : null);
  const [signInError] = useState(() => takeSignInErrorFromLocation());
  const [email, setEmail] = useState(initialEmail ?? "");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  // The desktop app came back from "Sign in with Pulsatrix" in the system
  // browser: redeem its credential once, without asking, when the app's main
  // process confirms it handed it over; anything else (a plain browser, a
  // posted link, a failure) falls back to the code form.
  const [finishing, setFinishing] = useState(
    autoSubmit && Boolean(initialCode) && typeof window !== "undefined" && typeof window.ogb?.takeSignInReturn === "function",
  );
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!finishing || !initialCode || autoStarted.current) return;
    autoStarted.current = true;
    void finishReturnedSignIn({
      code: initialCode,
      bridge: window.ogb,
      pair: () => pairWithCode({ code: initialCode, label: defaultDeviceLabel(), attemptId }),
    }).then((result) => {
      if (result === "ask") {
        setFinishing(false);
        return;
      }
      if (result.ok) {
        location.replace("/");
        return;
      }
      setError(result.error);
      setFinishing(false);
    });
  }, [finishing, initialCode, attemptId]);

  useEffect(() => {
    void fetch("/.well-known/openmausbot/environment")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EnvironmentDescriptor | null) => {
        setEnvironment(d);
        setMode((current) => current ?? (pulsatrixLoginPath(d) ? "pulsatrix" : d?.capabilities.emailSignIn ? "email" : "code"));
      })
      .catch(() => {
        setEnvironment(null);
        setMode((current) => current ?? "code");
      });
    void readSessionState().then(setSession);
  }, []);

  const connected = isConnected(session);
  // An organization server signs people in with Pulsatrix, never by email.
  const loginPath = pulsatrixLoginPath(environment);
  const emailOffered = !loginPath && environment?.capabilities.emailSignIn === true;

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await pairWithCode({ code, label, attemptId });
    setBusy(false);
    if (result.ok) {
      location.replace("/");
      return;
    }
    setError(result.error);
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = sent ? await verifyEmailSignIn({ email, code: otp, label }) : await startEmailSignIn(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (sent) {
      location.replace("/");
      return;
    }
    setSent(true);
  }

  function switchMode(next: "pulsatrix" | "email" | "code") {
    setMode(next);
    setError(null);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-6 text-ink">
      <div className="absolute left-3 top-12 max-w-[280px]"><DesktopWorkspaceSwitcher /></div>
      <div className="w-full max-w-[420px]">
        <h1 className="text-[20px] font-semibold">{t(mode === "email" || mode === "pulsatrix" ? "pair.heading.signIn" : "pair.heading.connect", { name: environment?.label ?? t("pair.heading.thisServer") })}</h1>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary">
          {environment ? `${t("pair.version", { version: environment.version, platform: environment.platform })} ` : ""}
          {mode === "pulsatrix"
            ? t("pair.pulsatrix.intro")
            : mode === "email"
            ? sent
              ? `We emailed an 8-digit code to ${email}. It works once and expires in ten minutes.`
              : "Enter your email and we will send you a one-time code."
            : t("pair.code.intro")}
        </p>
        {reasonWorthShowing(reason) && !connected ? <p className="mt-3 text-[13px] text-ink-secondary">{reasonWorthShowing(reason)}</p> : null}
        {connected ? (
          <p className="mt-4 text-[13.5px]">
            {t("pair.connected")}{" "}
            <a href="/" className="text-accent underline">
              {t("pair.openApp")}
            </a>
          </p>
        ) : finishing ? (
          <p role="status" className="mt-4 text-[13.5px] text-ink-secondary">{t("pair.pulsatrix.finishing")}</p>
        ) : mode === "pulsatrix" && loginPath ? (
          <div>
            {signInError ? <p role="alert" className="mt-3 text-[13px] text-danger">{signInErrorText(signInError)}</p> : null}
            {/* A full-page navigation: the server answers with the Perspicax
                sign-in page and comes back here with its own session cookie. */}
            <a href={loginPath} className={`${button} block text-center`}>
              {t("pair.pulsatrix.signIn")}
            </a>
            <button type="button" onClick={() => switchMode("code")} className="mt-3 w-full text-[13px] text-ink-secondary underline">
              {t("pair.pulsatrix.useCode")}
            </button>
          </div>
        ) : mode === "email" ? (
          <form onSubmit={submitEmail}>
            <label className={fieldLabel} htmlFor="signin-email">
              Email
            </label>
            <input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSent(false);
                setOtp("");
              }}
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              className={input}
            />
            {sent ? (
              <>
                <label className={fieldLabel} htmlFor="signin-code">
                  Code from the email
                </label>
                <input
                  id="signin-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="12345678"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  spellCheck={false}
                  className={`${input} font-mono text-[15px] tracking-[0.12em]`}
                />
                <label className={fieldLabel} htmlFor="signin-label">
                  This device
                </label>
                <input id="signin-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} className={input} />
              </>
            ) : null}
            {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
            <button type="submit" disabled={busy || !email.includes("@") || (sent && otp.replace(/\D/g, "").length < 8)} className={button}>
              {busy ? (sent ? "Signing in…" : "Sending…") : sent ? "Sign in" : "Send code"}
            </button>
            {sent ? (
              <button type="button" onClick={() => setSent(false)} className="mt-3 w-full text-[13px] text-ink-secondary underline">
                Send a new code
              </button>
            ) : null}
            <button type="button" onClick={() => switchMode("code")} className="mt-3 w-full text-[13px] text-ink-secondary underline">
              Have a pairing code instead?
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <label className={fieldLabel} htmlFor="pair-code">
              {t("pair.code.label")}
            </label>
            <input
              id="pair-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setAttemptId(newAttemptId());
              }}
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              className={`${input} font-mono text-[15px] tracking-[0.12em]`}
            />
            <label className={fieldLabel} htmlFor="pair-label">
              {t("pair.device")}
            </label>
            <input id="pair-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} className={input} />
            {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
            <button type="submit" disabled={busy || code.replace(/[^a-z0-9]/gi, "").length < 12} className={button}>
              {busy ? t("pair.code.connecting") : t("pair.code.connect")}
            </button>
            {loginPath ? (
              <button type="button" onClick={() => switchMode("pulsatrix")} className="mt-3 w-full text-[13px] text-ink-secondary underline">
                {t("pair.pulsatrix.signIn")}
              </button>
            ) : emailOffered ? (
              <button type="button" onClick={() => switchMode("email")} className="mt-3 w-full text-[13px] text-ink-secondary underline">
                Sign in with your email instead
              </button>
            ) : null}
          </form>
        )}
      </div>
    </main>
  );
}
