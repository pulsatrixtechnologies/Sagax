// App settings → People, on a hosted workspace whose members the
// organisation's Admin decides (portal membership): read-only, who has
// signed in here, what they spent this month, and a link to Admin → People.
// The emailed-code sign-in list this section used to edit is gone (slice 8).
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatUsd, hasFiniteCost } from "@/lib/usage";
import { readMembership, type Membership } from "../lib/membership";
import { readSessionState, type SessionState } from "../lib/session";
import { canPairDevices } from "./ServerPairingCard";
import { Card, cardCount } from "./SettingsPrimitives";

export type Role = "admin" | "member";


export interface Person {
  entry: string;
  role: Role;
  /** `@domain`: everyone at a company, not one person. */
  isDomain: boolean;
  lastSeenAt: number | null;
  devices: number;
  turns: number;
  costUsd: number | null;
  /** part of costUsd is estimated from list prices (see Usage → History) */
  estimated?: boolean;
}

/** One row per address that has signed in, for a workspace whose members
 * Admin manages: role from what their sessions may do, nothing to edit. */
export function peopleFromSessions(
  sessions: Array<{ email?: string; lastSeenAt: number; scopes?: string[] }>,
  usage: Array<{ key: string; turns: number; costUsd: number | null }>,
): Person[] {
  const byEmail = new Map<string, Array<{ lastSeenAt: number; scopes?: string[] }>>();
  for (const session of sessions) {
    const email = session.email?.trim().toLowerCase();
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), session]);
  }
  return [...byEmail.entries()].map(([entry, devices]) => {
    const month = usage.find((group) => group.key === `user:${entry}`);
    return {
      entry,
      role: devices.some((device) => device.scopes?.includes("admin")) ? "admin" : "member",
      isDomain: false,
      lastSeenAt: Math.max(...devices.map((device) => device.lastSeenAt)),
      devices: devices.length,
      turns: month?.turns ?? 0,
      costUsd: month?.costUsd ?? null,
    } satisfies Person;
  }).sort((a, b) => (a.role === b.role ? a.entry.localeCompare(b.entry) : a.role === "admin" ? -1 : 1));
}

export function lastSeenLabel(lastSeenAt: number | null, now = Date.now()): string {
  if (lastSeenAt === null) return t("people.never");
  if (now - lastSeenAt < 24 * 60 * 60_000) return t("people.today");
  return new Date(lastSeenAt).toISOString().slice(0, 10);
}

/** The table alone, so it renders the same from a fetch or a fixture.
 * Read-only: Admin decides membership. */
export function PeopleTable({ people }: { people: Person[] }) {
  if (people.length === 0) return <p className="text-[13px] text-ink-secondary">{t("people.portal.empty")}</p>;
  const columns = "grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4";
  return (
    <div className="flex flex-col">
      <div className={cn(columns, "border-b border-hairline/40 pb-2 text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary")}>
        <span>{t("people.colPerson")}</span>
        <span>{t("people.colRole")}</span>
        <span className="text-right">{t("people.colLastSeen")}</span>
        <span className="text-right">{t("people.colMonth")}</span>
        <span />
      </div>
      {people.map((person) => (
        <div key={person.entry} className={cn(columns, "border-b border-hairline/20 py-2 text-[13px]")}>
          <span className="min-w-0">
            <span className="block truncate text-ink">{person.isDomain ? t("people.everyoneAt", { domain: person.entry.slice(1) }) : person.entry}</span>
            {person.devices > 0 && <span className="block text-[11.5px] text-ink-secondary">{t("people.devices", { count: String(person.devices) })}</span>}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", person.role === "admin" ? "bg-accent/15 text-accent" : "bg-control text-ink-secondary")}>
            {person.role === "admin" ? t("people.roleAdmin") : t("people.roleMember")}
          </span>
          <span className="text-right tabular-nums text-ink-secondary">{person.isDomain ? "—" : lastSeenLabel(person.lastSeenAt)}</span>
          <span className="text-right tabular-nums text-ink" title={t("people.turns", { turns: String(person.turns) })}>
            {hasFiniteCost(person.costUsd) ? `${person.estimated ? "~" : ""}${formatUsd(person.costUsd)}` : "—"}
          </span>
          <span />
        </div>
      ))}
    </div>
  );
}

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* the link stays selectable when clipboard access is blocked */
    }
  };
  return (
    <div className="mt-3 rounded-lg border border-hairline/40 bg-inset p-3 text-[12.5px]">
      <div className="mb-1 text-ink-secondary">{t("people.link")}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all text-ink">{link}</code>
        <button type="button" onClick={() => void copy()} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink">
          {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}{copied ? t("people.copied") : t("people.copy")}
        </button>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">{t("people.linkHint")}</p>
    </div>
  );
}

/** Portal membership: this server's list decides nothing, so say where
 * people are managed and show, read-only, who has signed in here. */
export function PortalPeople({ peopleUrl, people }: { peopleUrl: string | null; people: Person[] }) {
  return (
    <Card collapsible cardId="people.portal" title={t("people.title")} subtitle={t("people.portal.subtitle")} summary={cardCount("people", people.length)}>
      <div data-people-portal className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-secondary">
        <p>{t("people.portal.managed")}</p>
        {peopleUrl && (
          <a
            href={peopleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-fit items-center gap-2 rounded-lg bg-control px-3 py-2 font-medium text-ink hover:bg-control/70"
          >
            {t("people.portal.open")} <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      <div className="mt-4">
        <PeopleTable people={people} />
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-secondary">{t("people.portal.note")}</p>
    </Card>
  );
}

export function PeopleSection() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  const load = useCallback(async () => {
    try {
      const [config, sessions, usage] = await Promise.all([
        api("/api/config"),
        api("/api/auth/sessions").catch(() => ({ sessions: [] })),
        api("/api/usage?groupBy=user").catch(() => ({ groups: [] })),
      ]);
      const authority = readMembership(config);
      setMembership(authority);
      const signedIn = Array.isArray(sessions?.sessions) ? sessions.sessions : [];
      const spent = Array.isArray(usage?.groups) ? usage.groups : [];
      setPeople(authority.authority === "portal" ? peopleFromSessions(signedIn, spent) : []);
    } catch {
      setPeople([]);
    }
  }, []);

  useEffect(() => {
    void readSessionState().then((state) => {
      setSession(state);
      if (canPairDevices(state)) void load();
    });
  }, [load]);

  if (!canPairDevices(session) || membership?.authority !== "portal") return null;
  return <PortalPeople peopleUrl={membership.peopleUrl} people={people} />;
}
