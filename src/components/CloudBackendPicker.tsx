// The Boat / Self-hosted VPS segmented control shown under the "Runs on"
// picker whenever a bot can end up on a cloud computer. One component, two
// homes (ComputerPanel and the bot settings dialog's Access section), so the copy and the disabled
// rules can never drift apart.
import type { CloudBackend } from "../../shared/wire";
import { cn } from "@/lib/cn";

export function CloudBackendPicker({
  value,
  compact = false,
  vpsSupported,
  organization = false,
  boat = true,
  vps = true,
  onChange,
}: {
  value: CloudBackend;
  compact?: boolean;
  vpsSupported: boolean;
  /** An organization server: a bot works in its owner's server environment,
   * so the per-bot VPS computer is not offered. */
  organization?: boolean;
  /** Boat Computer and VPS Computer (Settings > Experimental features):
   * a backend switched off is not offered. */
  boat?: boolean;
  vps?: boolean;
  onChange: (backend: CloudBackend) => void;
}) {
  const backends = (organization ? ["box"] as const : ["box", "vps"] as const).filter((backend) => backend === "vps" ? vps : boat);
  if (!backends.length) return null;
  return (
    <div className="mt-3 rounded-lg bg-inset p-3">
      <div className="text-[12px] font-medium text-ink">{compact ? "Cloud provider" : "Cloud backend"}</div>
      <div className="mt-0.5 text-[11.5px] text-ink-secondary">
        {organization
          ? "A hosted computer managed by Boat. Commands and files run in your server environment."
          : compact
          ? value === "vps" ? "Your own server, connected over SSH." : "A hosted computer managed by Boat."
          : value === "vps"
          ? "Auto reuses a running VPS by default. Enable Start VPS automatically to let Auto create or wake its managed container, or choose Cloud to do it explicitly. Open the live desktop securely from the computer panel."
          : "Boat is the default hosted computer. Choose Self-hosted VPS to use your SSH-configured Linux Docker host."}
      </div>
      <div className="mt-2 flex overflow-hidden rounded-lg border border-hairline/40">
        {backends.map((backend, i) => {
          const disabled = backend === "vps" && !vpsSupported;
          return (
            <button
              key={backend}
              disabled={disabled}
              title={disabled ? "Self-hosted VPS requires Claude or an ACP model provider" : undefined}
              onClick={() => onChange(backend)}
              className={cn(
                "flex-1 py-1.5 text-[12px]",
                i > 0 && "border-l border-hairline/40",
                disabled && "cursor-not-allowed opacity-40",
                value === backend ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
              )}
            >
              {backend === "vps" ? "Self-hosted VPS" : "Boat"}
            </button>
          );
        })}
      </div>
    </div>
  );
}
