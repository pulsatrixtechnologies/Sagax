// Settings > Computer: recover the bot's computer when it is stuck, or
// update it now (parity R7, system 6 and 5). Sagax keeps no snapshot of the
// computer: recover is the same rebuild as an update (POST
// /api/computer/update, server/routes/computer-status.ts), from the current
// image, files kept. The phone decides it the same way
// (ios/Sources/CompanionCore/Parity3F.swift ComputerCare.needsRecover).
import { api } from "@/state/store";

export interface ComputerStatusView {
  kind?: "org-sandbox" | "local";
  configured: boolean;
  state: string;
  problem?: string;
  waking?: { since: number; elapsedMs: number };
}

/** Up, or coming up on purpose. Anything else can be recovered. */
const HEALTHY = new Set(["running", "ready", "idle"]);

export function needsRecover(status: ComputerStatusView): boolean {
  if (!status.configured) return false;
  if (status.problem?.trim()) return true;
  if (status.waking) return true;
  return !HEALTHY.has(status.state);
}

/** The one action the row offers, or none (no computer here). */
export function computerAction(status: ComputerStatusView | null): "recover" | "update" | null {
  if (!status?.configured) return null;
  return needsRecover(status) ? "recover" : "update";
}

export function loadComputerStatus(signal?: AbortSignal): Promise<ComputerStatusView> {
  return api<ComputerStatusView>("/api/computer/status", signal ? { signal } : {});
}

/** Rebuild from the current image; the person's files stay. */
export function updateComputer(): Promise<ComputerStatusView> {
  return api<ComputerStatusView>("/api/computer/update", { method: "POST", body: "{}" });
}
