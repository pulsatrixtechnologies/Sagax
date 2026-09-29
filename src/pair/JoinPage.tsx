import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";

/** What the join page can show. "open" carries what the public preview
 * returned; the others are the server's answer, or "failed" when it could
 * not be reached or refused for another reason (a lockout, a save error). */
export type JoinState =
  | { kind: "loading" }
  | { kind: "open"; orgName: string; email: string; busy?: boolean; error?: string }
  | { kind: "expired" | "used" | "revoked" | "unknown" | "already-member" }
  | { kind: "joined"; orgName: string }
  | { kind: "failed"; error: string };

/** The token an invite link carries: `/join#token=...`. It stays in the
 * fragment so it never reaches a server log; it is dropped from the address
 * bar once read, like a pairing code. */
export function takeInviteTokenFromLocation(): string | null {
  const m = /[#&]token=([^&]+)/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** The public preview: status, and for an open invite the org's name and
 * the masked address. */
export async function previewInvite(token: string): Promise<JoinState> {
  try {
    const res = await fetch(`/api/org/invites/${encodeURIComponent(token)}/preview`, { cache: "no-store" });
    const body = await readJson(res);
    if (res.ok && body.status === "open" && typeof body.orgName === "string") {
      return { kind: "open", orgName: body.orgName, email: typeof body.email === "string" ? body.email : "" };
    }
    if (body.status === "expired" || body.status === "used" || body.status === "revoked" || body.status === "unknown") return { kind: body.status };
    return { kind: "failed", error: typeof body.error === "string" ? body.error : t("join.failed") };
  } catch {
    return { kind: "failed", error: t("join.failed") };
  }
}

/** Redeems the link. On success the server has set this browser's session
 * cookie. */
export async function joinInvite(token: string): Promise<JoinState> {
  try {
    const res = await fetch(`/api/org/invites/${encodeURIComponent(token)}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      credentials: "same-origin",
    });
    const body = await readJson(res);
    if (res.ok && body.status === "joined") return { kind: "joined", orgName: typeof body.orgName === "string" ? body.orgName : "" };
    if (body.status === "already-member" || body.status === "expired" || body.status === "used" || body.status === "revoked" || body.status === "unknown") return { kind: body.status };
    return { kind: "failed", error: typeof body.error === "string" ? body.error : t("join.failed") };
  } catch {
    return { kind: "failed", error: t("join.failed") };
  }
}

const card = "w-full max-w-[420px] rounded-[14px] border-[0.5px] border-border bg-elevated p-6";

/** The page, without effects: one state in, markup out. */
export function JoinView({ state, onJoin }: { state: JoinState; onJoin: () => void }) {
  const signIn = (
    <a href="/pair" className="ui-button ui-button-primary mt-5 inline-flex w-fit">
      {t("join.signIn")}
    </a>
  );
  let content;
  switch (state.kind) {
    case "loading":
      content = <p role="status" className="text-[13.5px] text-ink-secondary">{t("join.loading")}</p>;
      break;
    case "open":
      content = (
        <>
          <h1 className="text-[20px] font-semibold text-ink">{t("join.title", { org: state.orgName })}</h1>
          {state.email ? <p className="mt-1.5 text-[13.5px] text-ink-secondary">{t("join.invitedAs", { email: state.email })}</p> : null}
          <p className="mt-3 text-[13px] leading-relaxed text-ink-secondary">{t("join.help")}</p>
          {state.error ? <p role="alert" className="mt-3 text-[13px] text-danger">{state.error}</p> : null}
          <button type="button" disabled={state.busy} onClick={onJoin} className="ui-button ui-button-primary mt-5 disabled:opacity-50">
            {state.busy ? t("join.joining") : t("join.button")}
          </button>
        </>
      );
      break;
    case "joined":
      content = <p role="status" className="text-[13.5px] text-ink-secondary">{t("join.joined", { org: state.orgName })}</p>;
      break;
    case "already-member":
      content = (
        <>
          <h1 className="text-[20px] font-semibold text-ink">{t("join.fallbackTitle")}</h1>
          <p role="alert" className="mt-2 text-[13.5px] text-ink-secondary">{t("join.alreadyMember")}</p>
          {signIn}
        </>
      );
      break;
    case "used":
      content = (
        <>
          <h1 className="text-[20px] font-semibold text-ink">{t("join.fallbackTitle")}</h1>
          <p role="alert" className="mt-2 text-[13.5px] text-ink-secondary">{t("join.used")}</p>
          {signIn}
        </>
      );
      break;
    case "expired":
    case "revoked":
    case "unknown":
      content = (
        <>
          <h1 className="text-[20px] font-semibold text-ink">{t("join.fallbackTitle")}</h1>
          <p role="alert" className="mt-2 text-[13.5px] text-ink-secondary">{t(state.kind === "expired" ? "join.expired" : state.kind === "revoked" ? "join.revoked" : "join.unknown")}</p>
        </>
      );
      break;
    case "failed":
      content = (
        <>
          <h1 className="text-[20px] font-semibold text-ink">{t("join.fallbackTitle")}</h1>
          <p role="alert" className="mt-2 text-[13.5px] text-danger">{state.error}</p>
        </>
      );
      break;
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-4 text-ink">
      <div className={card}>{content}</div>
    </main>
  );
}

/** The page an invite link opens: /join#token=... */
export function JoinPage({ initialToken }: { initialToken: string | null }) {
  const [state, setState] = useState<JoinState>(initialToken ? { kind: "loading" } : { kind: "unknown" });

  useEffect(() => {
    if (!initialToken) return;
    let alive = true;
    void previewInvite(initialToken).then((next) => { if (alive) setState(next); });
    return () => { alive = false; };
  }, [initialToken]);

  const join = async () => {
    if (!initialToken || state.kind !== "open" || state.busy) return;
    const preview = state;
    setState({ ...preview, busy: true, error: undefined });
    const next = await joinInvite(initialToken);
    if (next.kind === "joined") {
      setState(next);
      location.replace("/");
      return;
    }
    // A lockout or a save error keeps the invite on screen so it can be retried.
    setState(next.kind === "failed" ? { ...preview, busy: false, error: next.error } : next);
  };

  return <JoinView state={state} onJoin={() => void join()} />;
}
