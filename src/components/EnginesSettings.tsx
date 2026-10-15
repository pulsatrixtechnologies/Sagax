// Engines settings: per-instance CLI path override. One "Set CLI…" button
// per engine reveals a picker: a "detected" dropdown of every binary the
// server found on PATH, plus a manual path input. Saving first probes the
// binary (`<cli> --version`, same PATH a real turn uses); a failed probe
// asks before registering: the classic miss is a path the terminal sees
// but this GUI app can't.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { EngineCard, RefreshEngines, engineReady } from "./EngineLibrary";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { ApiKeyEngineManage, EngineSetup, EngineUpdateNotice, EngineWarningNotice, isApiKeyEngine } from "./EngineSetup";
import { AddClaudeAccount, ClaudeAccountSettings } from "./ClaudeAccountSettings";
import { AddProviderAccount, CodexAccountSettings } from "./CodexAccountSettings";
import { DEVICE_SIGN_IN_COPY, deviceSignInProvider } from "./DeviceSignIn";
import { AntigravityFreeSpace } from "./AntigravityFreeSpace";
import { ManageMyKeysLink } from "./settings/MyEngines";
import { EngineConnect, paysWithText } from "./EngineConnect";
import { HarnessConnectorsSection } from "./HarnessConnectorsSection";
import { reloadMyEngines, useMyEngines, usePerspicaxOrg, type MyEngine } from "@/lib/perspicax-org";
import { canEditConfig, viewerCan, viewerIsOrgMember } from "@/lib/viewer";
import { boatComputerEnabled, connectedAppsEnabled, vpsComputerEnabled } from "@/lib/feature-flags";
import { OrgHostToolsNote, orgRefusesEngine } from "./OrgHostToolsNote";
import { Card, HelpTip } from "./SettingsPrimitives";
import { KeyList, ProviderKeyDialog } from "./settings/ProviderKeys";
import { CloudAgentProvidersSettings, useCloudAgentProviders } from "./settings/CloudAgentProvidersSettings";
import { VoiceEngineSettings } from "./settings/VoiceEngineSettings";
import { ImageGenerationSettings } from "./settings/ImageGenerationSettings";
import { LiveCallInstallationSettings } from "./LiveCallSettings";
import { ApiKeyRow, VpsConnection } from "./ApiKeys";

interface ProbeResult {
  ok: boolean;
  version?: string;
  message?: string;
}

function CustomPicker({ instance, cliDefault, onClose, onSaved }: {
  instance: InstanceInfo;
  cliDefault?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<string[] | null>(instance.cliCandidates ?? null);
  // `selected` starts EMPTY, never at instance.cli: a wrapper override
  // ("/ag claude agp") has no matching <option>, and a select whose value
  // points at a missing option renders the placeholder while still holding
  // the ghost value: the form would look empty yet refuse to save.
  const [selected, setSelected] = useState<string>("");
  const [manual, setManual] = useState<string>(
    // the current override rides the manual input unless it is exactly a
    // detected path (then the dropdown preselects it below)
    instance.cli && !(instance.cliCandidates ?? []).includes(instance.cli) ? instance.cli : "",
  );
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  // The describe() snapshot can be stale (CLI installed since last refresh);
  // re-fetch candidates once when the picker mounts so the dropdown is current.
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    api(`/api/cli-candidates?name=${encodeURIComponent(cliDefault ?? "")}`)
      .then(({ candidates: found }: { candidates: string[] }) => {
        setCandidates(found);
        if (!instance.cli) return;
        // preselect a detected override in the dropdown; a non-detected one
        // (wrapper string, moved binary) rides the manual input instead
        if (found.includes(instance.cli)) setSelected(instance.cli);
        else setManual(instance.cli);
      })
      .catch(() => setCandidates((prev) => prev ?? []));
  }, [cliDefault, instance.cli]);

  const value = manual.trim() || selected;
  const dirty = value !== (instance.cli ?? "");
  const busy = probing || saving;

  // Editing the path invalidates a previous probe result.
  useEffect(() => {
    setProbe(null);
  }, [value]);

  const persist = () => {
    if (busy || !value || !dirty) return;
    setSaving(true);
    setError(null);
    const committed = value; // freeze: inputs disable during save, but the
    // closure must not see a later keystroke either
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ cli: committed }),
    })
      // onSaved (refreshInstances) failing must NOT read as "not saved":
      // the PATCH already returned 200. Close regardless; the global banner
      // from refreshInstances already reports the refresh failure.
      .then(() => Promise.resolve(onSaved()).catch(() => {}))
      .then(onClose)
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  };

  const save = () => {
    if (busy || !value || !dirty) return;
    setProbing(true);
    setError(null);
    api("/api/cli-test", {
      method: "POST",
      body: JSON.stringify({ cli: value, driver: instance.driverKind }),
    })
      .then((result: ProbeResult) => {
        setProbe(result);
        // ok → save immediately; failed → hold for explicit confirmation
        if (result.ok) persist();
      })
      .catch((e) => setError(e.message))
      .finally(() => setProbing(false));
  };

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {candidates !== null && candidates.length > 0 && (
        <div className="relative">
          <select
            value={manual.trim() ? "" : selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setManual("");
            }}
            aria-label={t("engines.detectedAria", { name: instance.displayName })}
            disabled={busy}
            className="w-full appearance-none rounded-lg border border-hairline/40 bg-inset px-3 py-2 pr-8 font-mono text-[12px] text-ink focus:outline-none disabled:opacity-50"
          >
            <option value="">{t("engines.selectBinary")}</option>
            {candidates.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-secondary" />
        </div>
      )}
      <input
        type="text"
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (!value || !dirty) return; // nothing to save: same hint the disabled button gives
          save();
        }}
        placeholder={candidates?.length ? t("engines.manualPath") : "/absolute/path/to/cli"}
        aria-label={t("engines.customAria", { name: instance.displayName })}
        spellCheck={false}
        disabled={busy}
        className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[12px] text-ink placeholder:font-sans placeholder:text-ink-secondary focus:outline-none disabled:opacity-50"
      />
      {probe && !probe.ok && probe.message && (
        <div role="alert" className="flex gap-1.5 rounded-lg border border-warning/25 bg-warning/10 px-2.5 py-2 text-[12px] leading-relaxed text-warning">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <span>{t("engines.testFailed", { message: probe.message })}</span>
        </div>
      )}
      {probe?.ok && probe.version && (
        <div className="text-[12px] text-success">{t("engines.testPassed", { version: probe.version })}</div>
      )}
      {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-raised/50 hover:text-ink disabled:opacity-50"
        >
          {t("common.cancel")}
        </button>
        {probe && !probe.ok ? (
          <>
            <button
              onClick={() => setProbe(null)}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-raised/50 hover:text-ink disabled:opacity-50"
            >
              {t("engines.editPath")}
            </button>
            <button
              onClick={() => persist()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-danger hover:bg-raised-hover disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : t("engines.saveAnyway")}
            </button>
          </>
        ) : (
          <button
            onClick={save}
            disabled={busy || !value || !dirty}
            className={cn(
              "flex w-[72px] items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px]",
              "bg-raised text-ink hover:bg-raised-hover",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{t("common.save")}</>}
          </button>
        )}
      </div>
    </div>
  );
}

/** On an organization server, which engine cards to list: never one whose
 * CLI is not installed on the server. */
export function orgEngineRows(instances: InstanceInfo[], mine: readonly MyEngine[] | null): InstanceInfo[] {
  if (!mine) return instances;
  return instances.filter((instance) => mine.find((engine) => engine.instanceId === instance.instanceId)?.installed !== false);
}

/** `mine`: on an organization server, the signed-in person's own access to
 * this engine. The card then shows one line on what pays for their turns and
 * their own Connect or Disconnect (EngineConnect), never the server's account
 * (which serves no one's turns there: server/engine-credentials.ts). */
function EngineRow({ instance, mine, member = false, issuer = "" }: { instance: InstanceInfo; mine?: MyEngine; member?: boolean; issuer?: string }) {
  const { refreshInstances } = useStore();
  const [open, setOpen] = useState(false);
  const cliMotion = useMenuMotion(open);
  const [switching, setSwitching] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updatedVersion, setUpdatedVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasOpenFor = useRef<string | null>(null);

  // Close the picker when this instance's override changes to anything else
  // (a save from this row, another tab, or the 5-min refresh. The picker
  // initialized its fields from the OLD value and never re-syncs, so staying
  // open would show stale state.
  useEffect(() => {
    if (wasOpenFor.current !== null && wasOpenFor.current !== instance.cli) {
      setOpen(false);
    }
    wasOpenFor.current = instance.cli ?? null;
  }, [instance.cli]);

  const reset = () => {
    if (switching || updating) return;
    setSwitching(true);
    setError(null);
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ cli: "" }),
    })
      // The reset already succeeded once PATCH returns 200. A follow-up list
      // refresh failure should not tell the user the reset itself failed.
      .then(() => Promise.resolve(refreshInstances()).catch(() => {}))
      .catch((e) => setError(e.message))
      .finally(() => setSwitching(false));
  };

  const updateClaude = () => {
    if (switching || updating) return;
    setUpdating(true);
    setUpdatedVersion(null);
    setError(null);
    api(`/api/instances/${encodeURIComponent(instance.instanceId)}/claude-update`, {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(async ({ version }: { version: string }) => {
        setUpdatedVersion(version);
        await Promise.resolve(refreshInstances()).catch(() => {});
      })
      .catch((e) => setError(e.message))
      .finally(() => setUpdating(false));
  };

  const policyNote = instance.policy && <p className="mb-2 text-[12px] leading-relaxed text-ink-secondary">
    <span className="font-medium text-ink">{t("policy.managedBy", { organization: instance.policy.organizationName })}</span> · {instance.policy.reason}
  </p>;
  // An organization member: their own access only. The server's engine
  // (its CLI and its updates) is the admins' to change.
  // On an organization server an engine whose own tools cannot be held back
  // never runs a turn there (409 host_tools); its card says why.
  const hostToolsNote = (member || mine !== undefined) && orgRefusesEngine(instance) && <OrgHostToolsNote instance={instance} className="mb-3 text-[12px]" />;
  if (member && mine) return (
    <EngineCard instance={instance} personal={{ ready: mine.myTurns !== "none", line: paysWithText(mine), turns: mine.myTurns }}>
      {policyNote}
      {hostToolsNote}
      <div data-member-engine={instance.instanceId}><EngineConnect engine={mine} issuer={issuer} onChanged={reloadMyEngines} /></div>
    </EngineCard>
  );
  if (instance.readOnly) return <EngineCard instance={instance}>
    {policyNote}
    <p className="text-[13px] leading-relaxed text-ink-secondary">{t("organization.managedEngine")}</p>
    {!engineReady(instance) && <p className="mt-2 text-[12px] text-ink-secondary">{t("organization.engineUnavailable")}</p>}
  </EngineCard>;

  return (
    <EngineCard instance={instance} personal={mine && { ready: mine.myTurns !== "none", line: paysWithText(mine), turns: mine.myTurns }}>
      {policyNote}
      {hostToolsNote}
      {mine && <EngineConnect engine={mine} issuer={issuer} onChanged={reloadMyEngines} className="mb-3" />}
      {!mine && !engineReady(instance) && <EngineSetup instance={instance} intent={instance.access === "custom" ? "inject" : "cloud"} unframed />}
      {!mine && engineReady(instance) && <ApiKeyEngineManage instance={instance} className="mt-3" />}
      {instance.snapshot.update && <EngineUpdateNotice update={instance.snapshot.update} instance={instance} className="mt-3" />}
      {instance.snapshot.warning && <EngineWarningNotice warning={instance.snapshot.warning} className="mt-3" />}
      {!mine && instance.claudeAccount && <ClaudeAccountSettings instance={instance} />}
      {!mine && engineReady(instance) && instance.snapshot.authenticated === true && (
        (instance.authentication?.method === "device-code" || instance.authentication?.method === "browser-pkce") && deviceSignInProvider(instance.driverKind) === "codex"
          ? <CodexAccountSettings instance={instance} />
          : instance.authentication?.method === "device-code"
          ? <p className="flex items-center gap-1.5 text-[12px] text-success"><Check size={13} />{t(DEVICE_SIGN_IN_COPY[deviceSignInProvider(instance.driverKind)].connectedAccount)}</p>
          : instance.authentication?.method === "open-link"
          ? <p className="flex items-center gap-1.5 text-[12px] text-success"><Check size={13} />{t(DEVICE_SIGN_IN_COPY.cursor.connectedAccount)}</p>
          : instance.authentication?.method === "paste-code" && !instance.claudeAccount && (
            <p className="flex items-center gap-1.5 text-[12px] text-success"><Check size={13} />{t("engineSetup.claude.connectedAccount")}</p>
          )
      )}
      {instance.freeUpSpace && <AntigravityFreeSpace instance={instance} />}
      {!member && instance.driverKind === "antigravityAgent" && (
        <div className="mt-3 space-y-3">
          {instance.snapshot.authenticated && <p className="break-words text-[12px] text-ink-secondary">{instance.snapshot.account?.email ?? t("engineSetup.antigravity.emailUnavailable")}</p>}
          <AddProviderAccount antigravityInstanceId={instance.instanceId} />
        </div>
      )}
      {!member && instance.driverKind === "claudeAgent" && instance.access !== "custom" && (
        <div className="mt-3"><AddClaudeAccount /></div>
      )}
      {!member && instance.snapshot.chatgptPlan && !instance.snapshot.authenticationUnavailableReason && (
        <div className="mt-3"><AddProviderAccount /></div>
      )}
      <details className="mt-4 border-t border-hairline/40 pt-3">
        <summary className="cursor-pointer rounded-md py-1 text-[12px] font-medium text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent">{t("engines.library.advanced")}</summary>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("engines.footer")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          {instance.cli ? (
            <span className="w-full break-all font-mono text-[11.5px] text-ink-secondary" title={instance.cli}>
              {instance.cli}
            </span>
          ) : (
            instance.cliDefault && (
              <span className="break-all font-mono text-[11px] text-ink-secondary">{instance.cliDefault}</span>
            )
          )}
          {instance.snapshot.version && (
            <span className="break-all text-[11px] text-ink-secondary" title={instance.snapshot.version}>
              {instance.snapshot.version}
            </span>
          )}
          <span className="flex-1" />
          {instance.driverKind === "claudeAgent" && (
            <button
              onClick={updateClaude}
              disabled={switching || updating}
              className="flex shrink-0 items-center gap-1 text-[11.5px] text-ink-secondary hover:text-ink disabled:opacity-50"
            >
              {updating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {updating ? t("engines.updating") : t("engines.updateClaude")}
            </button>
          )}
          {instance.cli && (
            <button
              onClick={reset}
              disabled={switching || updating}
              className="shrink-0 text-[11.5px] text-ink-secondary hover:text-ink disabled:opacity-50"
            >
              {switching ? t("engines.resetting") : t("engines.reset")}
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={updating}
            aria-expanded={open}
            className={cn(
              "shrink-0 rounded-lg border border-hairline/40 px-3 py-1 text-[12px]",
              open ? "bg-accent/15 text-accent" : "text-ink-secondary hover:bg-raised/50 hover:text-ink",
              "disabled:opacity-50",
            )}
          >
            {t("engines.setCli")}
          </button>
        </div>
        {updatedVersion && (
          <div role="status" className="mt-1 text-[12px] text-success">{t("engines.claudeUpdated", { version: updatedVersion })}</div>
        )}
        {error && <div role="alert" className="mt-1 text-[12px] text-danger">{error}</div>}
        {cliMotion.shown && (
          <div className={cliMotion.className} {...cliMotion.exitProps}>
            <CustomPicker
              instance={instance}
              cliDefault={instance.cliDefault}
              onClose={() => setOpen(false)}
              onSaved={refreshInstances}
            />
          </div>
        )}
      </details>
    </EngineCard>
  );
}

/** Settings > Models and voice (2026-10-14): one page instead of
 * Integrations and Models and accounts. Auto in one line; every key (model,
 * voice and image) in one list with the rare ones under More providers, the
 * only place a key is managed (2026-10-15); the engines, the ready ones in
 * view and the others folded under Needs setup; the voice engine, which uses
 * its key from the list, with Live calls under Advanced; then image
 * generation (its key also in the list) and, when their experiments are on,
 * the online computers. */
export function EnginesSettings() {
  const { state } = useStore();
  // every KNOWN-driver instance has cliDefault; unknown-driver shadows have
  // neither unless an override was set. Including them keeps a Reset-able row
  // (and a Set CLI… path) for engines the running build doesn't recognize.
  // An organization member's copy of the engines carries no CLI fields
  // (server memberInstanceView): their rows are the engines the server
  // reports to them (orgEngineRows keeps the installed ones). Key engines
  // have no CLI; keep them once their key is saved, or the card (and the
  // only way back to a mistyped key) vanishes (MOCA-292).
  // 2026-10-09: a member whose profile includes engines.manage manages the
  // server's engines as an admin does (the server sends them the full rows).
  const member = viewerIsOrgMember(state.config) && !viewerCan(state.config, "engines.manage");
  const rows = state.instances.filter((i) => member || i.readOnly || i.cli !== undefined || i.cliDefault !== undefined || i.snapshot.state === "unavailable" || isApiKeyEngine(i));
  // On an organization server each person signs in their own subscription
  // here, on each engine's card (it was a separate "My subscriptions and
  // keys" card until 2026-10-02), never the server's.
  const org = usePerspicaxOrg();
  const myEngines = useMyEngines();
  const mineOf = (instance: InstanceInfo) => (org ? myEngines?.find((engine) => engine.instanceId === instance.instanceId) : undefined);
  const shown = org ? orgEngineRows(rows, myEngines).filter((instance) => !member || mineOf(instance)) : rows;
  const isReady = (instance: InstanceInfo) => { const mine = mineOf(instance); return mine ? mine.myTurns !== "none" : engineReady(instance); };

  // Keys are an installation write: a member's own keys live in Perspicax.
  const remote = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const keys = !member && !remote;
  // The voice engine, image generation and online computers write the
  // installation too: shown to whoever may change it (Integrations was
  // hidden the same way).
  const installation = !member && canEditConfig(state.config);
  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2" data-models-voice="">
      {member && (
        <div className="-mt-1 flex flex-wrap items-center justify-end gap-1">
          <p className="mr-auto text-[13px] text-ink-secondary">{t("myEngines.memberIntro")}</p>
          {org && <ManageMyKeysLink issuer={org.org.identity.issuer} />}
        </div>
      )}
      {/* Auto (docs/plans/2026-10-08-auto-model.md): one line, the detail behind its info button. */}
      <section data-auto-model-explainer className="flex items-center gap-1.5">
        <h2 className="text-[13px] font-medium text-ink">{t("model.auto.settings.title")}</h2>
        <span className="text-[13px] text-ink-secondary">{t("model.auto.settings.short")}</span>
        <HelpTip label={t("settings.moreAbout", { title: t("model.auto.settings.title") })}>{t("model.auto.settings.body")}</HelpTip>
      </section>
      {keys && <KeysSection issuer={org?.org.identity.issuer} />}
      <EnginesSection
        engines={shown}
        isReady={isReady}
        refresh={!member}
        renderEngine={(instance) => <EngineRow instance={instance} mine={mineOf(instance)} member={member} issuer={org?.org.identity.issuer} />}
        connectors={!connectedAppsEnabled(state.config)}
        empty={Boolean(member && org && myEngines !== null && shown.length === 0)}
      />
      {installation && <VoiceSection keysLink={keys} />}
      {installation && (
        <Card collapsible cardId="connections.image" defaultOpen={false} title={t("imageGen.title")} subtitle={t("imageGen.subtitle")}>
          <ImageGenerationSettings keysLink={keys} />
        </Card>
      )}
      {installation && (boatComputerEnabled(state.config) || vpsComputerEnabled(state.config)) && (
        <Card collapsible cardId="connections.integrations" defaultOpen={false} title={t("keys.integrations.title")}>
          <div className="flex flex-col gap-4">
            {boatComputerEnabled(state.config) && <ApiKeyRow section="box" />}
            {vpsComputerEnabled(state.config) && <VpsConnection />}
          </div>
        </Card>
      )}
      {(keys || installation) && <ProviderKeyDialog />}
    </div>
  );
}

/** One list of every key. "Manage my keys in Perspicax" leads it when the
 * server is linked to an organization. The cloud coding agents' keys stay
 * under More providers until one is saved. */
function KeysSection({ issuer }: { issuer?: string }) {
  const cloud = useCloudAgentProviders();
  const cloudSaved = cloud.rows?.some((row) => row.configured) ?? false;
  const cloudCard = <CloudAgentProvidersSettings state={cloud} />;
  return (
    <section className="flex flex-col gap-2" data-settings-card="engines.keys" data-keys-section="">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
          {t("modelsVoice.keys.title")}
          <HelpTip label={t("settings.moreAbout", { title: t("modelsVoice.keys.title") })}>{t("providerKeys.help")}</HelpTip>
        </h2>
        {issuer && <span className="ml-auto"><ManageMyKeysLink issuer={issuer} /></span>}
      </div>
      <KeyList moreExtra={cloudSaved ? undefined : cloudCard} />
      {cloudSaved && cloudCard}
    </section>
  );
}

/** The engines (2026-10-15): the ready ones always in view, with Check
 * again; the ones to set up folded under "Needs setup" with their count,
 * open by default only while none is ready. A card that changes group
 * remounts (its sign-in or CLI draft is done by then: it changed state). */
function EnginesSection({ engines, isReady, refresh, renderEngine, connectors, empty }: {
  engines: InstanceInfo[];
  isReady: (instance: InstanceInfo) => boolean;
  /** Check again: whoever manages the server's engines. */
  refresh: boolean;
  renderEngine: (instance: InstanceInfo) => ReactNode;
  /** The read-only claude.ai connectors, while Connected apps is off. */
  connectors: boolean;
  /** An organization member with no engine on this server. */
  empty: boolean;
}) {
  const ready = engines.filter(isReady);
  const setup = engines.filter((instance) => !isReady(instance));
  const count = (n: number) => t(n === 1 ? "engines.library.countOne" : "engines.library.count", { count: n });
  const grid = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] items-start gap-3";
  return (
    <section className="flex flex-col gap-3" data-settings-card="engines.list" data-engines-list="">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="text-[13px] font-medium text-ink">{t("engines.title")}</h2>
        {refresh && <span className="ml-auto"><RefreshEngines /></span>}
      </div>
      {/* The claude.ai connectors of the person's own Claude account live in
          Connected apps; while that experiment is off, their read-only
          status shows here, next to the Claude sign-in that brings them. */}
      {connectors && <HarnessConnectorsSection placement="settings" />}
      {ready.length > 0 && (
        <div className="flex flex-col gap-2" data-engines-ready="">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-semibold text-ink-secondary">{t("onboarding.engines.ready")}</h3>
            <span className="text-[11px] tabular-nums text-ink-secondary">{count(ready.length)}</span>
          </div>
          <div className={grid}>
            {ready.map((instance) => <div key={instance.instanceId} className="contents">{renderEngine(instance)}</div>)}
          </div>
        </div>
      )}
      {setup.length > 0 && (
        <Card
          collapsible
          cardId="engines.setup"
          defaultOpen={ready.length === 0}
          title={t("onboarding.engines.needsSetup")}
          summary={count(setup.length)}
        >
          <div className={grid} data-engines-setup="">
            {setup.map((instance) => <div key={instance.instanceId} className="contents">{renderEngine(instance)}</div>)}
          </div>
        </Card>
      )}
      {engines.length === 0 && !empty && <p className="py-2 text-[13px] text-ink-secondary">{t("engines.none")}</p>}
      {empty && <p className="text-[13px] text-ink-secondary" data-member-no-engines>{t("myEngines.noneOnServer")}</p>}
    </section>
  );
}

/** The voice engine only: which one speaks, and its own settings. Its key is
 * a row of the Keys list (Grok uses the xAI key): this section only says
 * whether it is saved, with "Add in Keys" when it is missing (2026-10-15).
 * Live calls and their limits sit under Advanced, folded; values set there
 * stay applied while it is folded. */
function VoiceSection({ keysLink }: { keysLink: boolean }) {
  return (
    <section className="flex flex-col gap-2" data-settings-card="connections.voice" data-voice-section="">
      <div>
        <h2 className="text-[13px] font-medium text-ink">{t("modelsVoice.voice.title")}</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-secondary">{t("voice.engine.subtitle")}</p>
      </div>
      <VoiceEngineSettings keysLink={keysLink} />
      <Card collapsible cardId="voice.advanced" defaultOpen={false} title={t("modelsVoice.voice.advanced")}>
        <div data-voice-advanced="">
          <div className="text-[13px] font-medium text-ink">{t("voice.live.title")}</div>
          <p className="mb-3 mt-0.5 text-[12.5px] text-ink-secondary">{t("voice.live.subtitle")}</p>
          <LiveCallInstallationSettings />
        </div>
      </Card>
    </section>
  );
}
