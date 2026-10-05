import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { cloudEngineOf } from "@/lib/remote-desktop";
import { useMenuMotion } from "./MenuMotion";
import { boatComputerEnabled, browserAvailable, builtInBrowserEnabled, vpsComputerEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { instanceSupportsLocalComputer, localComputerSelectable } from "@/lib/local-computer";
import { effectivePlace, PLACES, placeLabelKey, placeOffered, type Place } from "@/lib/place";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useStore, type Bot, type Task } from "@/state/store";
import { canWorkOnCloud } from "../../shared/cloud-computer";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { PlaceIcon } from "./PlaceIcon";

export type PlaceAvailability = Record<Place, boolean>;

/** An organization server (Perspicax): Cloud is the person's server
 * environment and Auto means Cloud (src/lib/place.ts). */
export function useOrganizationServer(): boolean {
  return usePerspicaxOrg() !== null;
}

/** The same reachability the Works on picker applies, so the chip never
 * offers a place the panel would grey out. */
export function usePlaceAvailability(bot: Bot): PlaceAvailability {
  const { state } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const organization = useOrganizationServer();
  const instance = state.instances.find((candidate) => candidate.instanceId === bot.modelSelection.instanceId);
  const computerMcp = instance?.capabilities?.computerMcp === true;
  const boxAgent = instance?.driverKind === "boxAgent";
  const backend = bot.cloudBackend === "vps" ? "vps" : "box";
  // Places the enrolled organisation disallows, or this server never
  // offers (an OMB Cloud home), are not reachable.
  const allowed = state.config?.managedPolicy?.computers ?? { thisComputer: true, localVm: true, box: true, vps: true };
  const local = localComputerSelectable({ capabilities, providerSupportsLocal: instanceSupportsLocalComputer(state.instances, bot) }) && allowed.thisComputer;
  const browser = builtInBrowserEnabled(state.config) && browserAvailable(state.config) && instance?.capabilities?.browserMcp === true && !boxAgent;
  // Organization server: Cloud is the person's server environment and the
  // Local VM is the one on their own computer (through the Sagax app); the
  // experimental VPS and Boat flags have nothing to do with either.
  if (organization) return { cloud: true, vm: allowed.localVm, local, browser };
  return {
    // the server's cloud rule (shared/cloud-computer.ts), behind Sagax's
    // experimental VPS and Boat flags (always offered on a Cloud home)
    cloud: canWorkOnCloud(cloudEngineOf(instance), backend) && allowed[backend]
      && (state.config?.cloudHome === true || (backend === "vps" ? vpsComputerEnabled(state.config) : boatComputerEnabled(state.config))),
    vm: Boolean(instance?.snapshot?.state === "available" && computerMcp && !boxAgent) && allowed.localVm && placeOffered("vm", state.config),
    local: local && placeOffered("local", state.config),
    browser,
  };
}

const DESCRIPTION: Record<Place, LocaleKey> = {
  cloud: "computer.dest.cloudDesc", vm: "computer.dest.vmDesc", local: "computer.dest.localDesc", browser: "computer.dest.browserDesc",
};
const ORG_DESCRIPTION: Record<Place, LocaleKey> = {
  cloud: "computer.dest.cloudOrgDesc", vm: "computer.dest.vmOrgDesc", local: "computer.dest.localOrgDesc", browser: "computer.dest.browserDesc",
};

/** Where this conversation works, beside the send button. Shows the
 * effective place (the conversation's pin, else the bot's Works on), pulses
 * while a turn is acting there, and pins another place for this
 * conversation only. No confirmation card: choosing is the whole gesture. */
export function PlaceChip({ bot, task, live, disabled = false, onPin, initialOpen = false }: {
  bot: Bot;
  task?: Pick<Task, "surface"> | null;
  live: boolean;
  disabled?: boolean;
  onPin: (surface: Place | null) => void;
  /** Tests: render with the menu open. */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const motion = useMenuMotion(open);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { state, dispatch } = useStore();
  const availability = usePlaceAvailability(bot);
  const organization = useOrganizationServer();
  const effective = effectivePlace(bot, task);
  const pinned = Boolean(task?.surface);
  const off = effective === "off";
  const label = t(placeLabelKey(effective, organization));
  const showLive = live && effective !== "off" && effective !== "auto";
  const title = off ? t("place.offHint") : disabled ? t("place.busy") : pinned ? t("place.pinnedHere") : t("place.fromBot");

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const choose = (surface: Place | null) => { setOpen(false); if (surface !== (task?.surface ?? null)) onPin(surface); };
  const botDefault = bot.computer ?? "auto";
  // A bot on Auto offers Auto itself as the unpinned default, rather than
  // "follow this bot's setting" spelled out to end in the same word. On an
  // organization server the row keeps saying what Auto means (Cloud).
  const followsAuto = botDefault === "auto" && !organization;

  return (
    <div className="relative flex items-center" ref={wrapperRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("place.chipAria", { place: label })}
        disabled={disabled}
        title={off || disabled ? title : `${label} — ${title}`}
        data-testid="place-chip"
        onClick={() => {
          if (off) {
            dispatch({ type: "toggleComputer", open: true });
            return;
          }
          setOpen((value) => !value);
        }}
        className={cn(
          "relative flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] text-ink-secondary hover:bg-control hover:text-ink",
          pinned && "text-accent hover:text-accent",
          off && !disabled && "opacity-45",
          disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          <PlaceIcon place={effective} size={16} className="shrink-0 opacity-80" aria-hidden="true" />
          {showLive && <span className="absolute -right-0.5 -top-0.5 size-1.5 animate-pulse rounded-full bg-success" aria-label={t("place.live")} />}
        </span>
        <span>{t("place.forConversation")}</span>
      </button>
      {motion.shown && (
        // Same surface and scale as the right-click menus. The title stays
        // on the menu's aria-label only.
        <div role="menu" aria-label={t("place.chipTitle")} className={cn("absolute bottom-full left-0 z-40 mb-2 w-[260px] overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated p-1.5", motion.className)} {...motion.exitProps}>
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!pinned}
              onClick={() => choose(null)}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover"
            >
              <PlaceIcon place={botDefault} size={16} className="mt-px shrink-0 text-ink" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-[18px] text-ink">{followsAuto ? t("place.auto") : t("place.followBot")}</span>
                <span className="block text-[12px] leading-4 text-ink-tertiary">
                  {followsAuto ? t("place.autoDetail") : t("place.followBotDetail", { place: t(placeLabelKey(botDefault, organization)) })}
                </span>
              </span>
              {!pinned && <Check size={14} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />}
            </button>
            {PLACES.filter((place) => placeOffered(place, state.config, organization)).map((place) => {
              const selected = task?.surface === place;
              const reachable = availability[place];
              // An option this bot cannot use here is left out, unless it is
              // the one already chosen (so the current place never vanishes).
              if (!reachable && !selected) return null;
              return (
                <button
                  key={place}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  disabled={!reachable}
                  title={reachable ? undefined : t("place.unavailable")}
                  onClick={() => choose(place)}
                  className={cn("flex items-start gap-2 rounded-md px-2 py-1.5 text-left", reachable ? "hover:bg-hover" : "cursor-not-allowed opacity-45")}
                >
                  <PlaceIcon place={place} size={16} className="mt-px shrink-0 text-ink" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-[18px] text-ink">{t(placeLabelKey(place, organization))}</span>
                    <span className="block text-[12px] leading-4 text-ink-tertiary">{reachable ? t((organization ? ORG_DESCRIPTION : DESCRIPTION)[place]) : t("place.unavailable")}</span>
                  </span>
                  {selected && <Check size={14} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
