// Where a bot works when its Works on is Auto (organization mode): the bot
// itself picks the computer per task or step with `computer_select`, served
// as the "sagax-computer" tool server (server/user-sandbox-proxy.ts). Pure:
// the server keeps the state per turn (TurnWorkplace.auto in index.ts) and
// asks this module what is allowed. Tests: server/auto-computer.test.ts.
//
//   cloud          the person's server environment (sagax-environment)
//   this_computer  their own computer through their Sagax desktop app
//                  (sagax-desktop: shell, files, apps, network, screen)
//   local_vm       the Local VM on their computer (sagax-desktop local_vm)
//
// A fixed Works on (Cloud, Local VM, This computer, Browser, Off) stays
// fixed: the tool only reports it. Nothing here widens what a turn may
// reach: the desktop bridge, the person's consent for a Local VM, host tools
// withheld, private threads and payer rules are unchanged.

/** The MCP server computer_select is mounted under. */
export const AUTO_COMPUTER_MCP_NAME = "sagax-computer";

export type AutoComputerTarget = "cloud" | "local_vm" | "this_computer";
export const AUTO_COMPUTER_TARGETS: readonly AutoComputerTarget[] = ["cloud", "this_computer", "local_vm"];

/** The fixed Works on of a turn, when it is not Auto. */
export type FixedWorksOn = "cloud" | "vm" | "local" | "browser" | "off";

export interface AutoComputerState {
  /** Works on is Auto for this turn (bot setting, or the thread's override). */
  auto: boolean;
  /** The fixed setting when not Auto. */
  fixed?: FixedWorksOn;
  /** Where the next tool call runs; null before anything was chosen. */
  selected: AutoComputerTarget | null;
  /** The turn belongs to a routine (runs as the bot owner, unattended). */
  routine: boolean;
  /** The person's server environment is configured on this server. */
  sandboxConfigured: boolean;
  /** The desktop tools (sagax-desktop) were mounted for this turn. */
  desktopMounted: boolean;
  /** Routines may use the owner's computer (their own preference). */
  routinesAllowed: boolean;
}

export interface AutoComputerSelection {
  ok: boolean;
  /** The text the tool answers with (the bot can relay it). */
  text: string;
  /** The new selection when ok. */
  target?: AutoComputerTarget;
  /** The previous selection, when it changed. */
  from?: AutoComputerTarget | null;
  /** True when the selection actually changed (audit only then). */
  changed?: boolean;
}

const FIXED_LABEL: Record<FixedWorksOn, string> = {
  cloud: "Cloud (server environment)",
  vm: "Local VM",
  local: "This computer",
  browser: "Browser",
  off: "Off",
};

export function autoComputerLabel(target: AutoComputerTarget): string {
  return target === "cloud" ? "the cloud (their server environment)" : target === "local_vm" ? "the Local VM on their computer" : "their own computer";
}

/** "cloud", "local_vm", "this_computer" and a few spellings a model may use. */
export function parseAutoComputerTarget(value: unknown): AutoComputerTarget | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "cloud" || key === "server" || key === "server_environment") return "cloud";
  if (key === "this_computer" || key === "local" || key === "computer" || key === "my_computer") return "this_computer";
  if (key === "local_vm" || key === "vm") return "local_vm";
  return null;
}

/** The tool, as tools/list shows it. */
export const COMPUTER_SELECT_TOOL = {
  name: "computer_select",
  description:
    "Choose where your next tool calls run in this turn when this bot's Works on is Auto: cloud = the person's server environment (sagax-environment tools), this_computer = their own computer through their Sagax desktop app (sagax-desktop tools), local_vm = the isolated Local VM on their computer (sagax-desktop local_vm tool: shell, and use to see and drive that VM's desktop). Give a short reason. You can switch again mid-task. Call with no target to see where you work now and what is available. A fixed Works on cannot be changed here.",
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", enum: ["cloud", "this_computer", "local_vm"], description: "Where the next tool calls run." },
      reason: { type: "string", description: "One short sentence: why this place for this step (shown to the person and kept in the activity log)." },
    },
    additionalProperties: false,
  },
} as const;

/** Why a target cannot be used right now, or null when it can. */
export function autoComputerUnavailable(state: AutoComputerState, target: AutoComputerTarget, desktopConnected: boolean): string | null {
  if (target === "cloud") {
    return state.sandboxConfigured ? null
      : "The server environment (cloud) is not enabled on this server. Tell the person; an administrator can enable it.";
  }
  if (state.routine && !state.routinesAllowed) {
    return "This is a routine: it uses the owner's computer only when they allowed routines on it (Settings > Computer, Where bots work). It keeps working in the cloud.";
  }
  if (!state.desktopMounted || !desktopConnected) {
    return "The person's computer is not connected: their Sagax desktop app is closed or signed out. Ask them to open it, signed in to this server, then send the request again; or work in the cloud.";
  }
  return null;
}

/** What computer_select answers, and the new selection. */
export function selectAutoComputer(
  state: AutoComputerState,
  request: { target?: unknown; reason?: unknown },
  desktopConnected: boolean,
): AutoComputerSelection {
  if (!state.auto) {
    const fixed = FIXED_LABEL[state.fixed ?? "off"];
    return { ok: false, text: `This bot's Works on is fixed to ${fixed}, so you cannot switch computers. Only the person can change it (the bot's Computer tab, or the composer's computer menu for this conversation, set to Auto).` };
  }
  const available = AUTO_COMPUTER_TARGETS.filter((target) => autoComputerUnavailable(state, target, desktopConnected) === null);
  const now = state.selected ? autoComputerLabel(state.selected) : "nowhere yet";
  if (request.target === undefined || request.target === null || request.target === "") {
    return { ok: true, text: `You work on ${now}. Available now: ${available.join(", ") || "none"}.` };
  }
  const target = parseAutoComputerTarget(request.target);
  if (!target) return { ok: false, text: "target must be cloud, this_computer or local_vm." };
  const unavailable = autoComputerUnavailable(state, target, desktopConnected);
  if (unavailable) return { ok: false, text: `${unavailable} You still work on ${now}.` };
  const tools = target === "cloud" ? "Use the sagax-environment tools."
    : target === "local_vm" ? "Use the sagax-desktop local_vm tool (status, start, run, and use to see and drive the VM desktop; create asks the person on their computer first)."
    : "Use the sagax-desktop tools.";
  if (state.selected === target) return { ok: true, text: `You already work on ${autoComputerLabel(target)}. ${tools}`, target, from: target, changed: false };
  return { ok: true, text: `Now working on ${autoComputerLabel(target)}. ${tools}`, target, from: state.selected, changed: true };
}

/** A short reason for the audit: one line, at most 200 characters. */
export function autoComputerReason(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

/** Whether one tool call of a proxied server may run under the current Auto
 * selection: null when it may, else the text the tool answers with. */
export function autoComputerToolRefusal(
  selected: AutoComputerTarget | null,
  server: "sagax-environment" | "sagax-desktop",
  toolName: string,
): string | null {
  if (server === "sagax-environment") {
    if (selected === "cloud") return null;
    return selected
      ? `You chose to work on ${autoComputerLabel(selected)} in this turn, so the server environment tools are not in use. Use the sagax-desktop tools, or call computer_select with target cloud first.`
      : "Call computer_select with target cloud before using the server environment tools.";
  }
  if (selected === "this_computer") return null;
  if (selected === "local_vm") {
    return toolName === "local_vm" ? null
      : "You chose the Local VM: use the sagax-desktop local_vm tool (status, start, run, create, or use to see and drive its desktop). Call computer_select with target this_computer to work on the person's own machine directly.";
  }
  return selected === "cloud"
    ? "You work in the cloud (the person's server environment) in this turn. Call computer_select with target this_computer or local_vm before using the tools on their computer."
    : "Call computer_select with target this_computer or local_vm before using the tools on the person's computer.";
}

/** The system guidance an Auto turn gets (provider text only). */
export function autoComputerGuidance(state: AutoComputerState, desktopConnected: boolean): string {
  const available = AUTO_COMPUTER_TARGETS.filter((target) => autoComputerUnavailable(state, target, desktopConnected) === null);
  const start = state.selected ? autoComputerLabel(state.selected) : "no computer";
  return [
    `<workplace>This bot's Works on is Auto: you choose where each task or step runs with the computer_select tool (target cloud, this_computer or local_vm, plus a short reason). This turn starts on ${start}; available now: ${available.join(", ") || "none"}. Your choice holds for the next tool calls of this turn and you can switch again mid-task; each new message starts over from the default.`,
    "- this_computer: anything on the person's own machine: their files and folders, their apps, their local network and printers, devices plugged in (USB, camera), Docker on their computer, local dev servers (localhost), their VPN.",
    "- local_vm: isolated or risky work on their machine (try an install, run untrusted code) in the Local VM, including seeing and driving that VM's desktop (local_vm action use); creating one asks them on their computer first.",
    "- cloud: heavy or long tasks, internet browsing and scraping, work that must keep running when their laptop is closed, and whenever their computer is not connected.",
    "The person's own words win: \"sur mon Mac\", \"sur mon ordinateur\", \"on my computer\", \"localement\", \"locally\" mean this_computer; \"dans une VM\", \"in a VM\" mean local_vm; \"dans le cloud\", \"in the cloud\", \"sur le serveur\", \"on the server\" mean cloud. Select before the first tool call of a step. If the place they asked for is unavailable, say why (the tool's answer) instead of quietly working elsewhere. Use computer_select, not select_computer, for this.</workplace>",
  ].join("\n");
}
