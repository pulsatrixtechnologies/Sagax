// A bot takes this computer's screen, mouse and keyboard (2026-10-28).
//
// A bot asked for "the latest video of" someone opened Chrome on the
// person's own screen and clicked through it in front of them, who thought
// their computer was possessed. Web work now happens out of sight
// (HOST_SCREEN_RULE, server/surface.ts). When a bot does take this computer,
// the person sees it twice: this one line in the conversation, written by
// Sagax at the turn's first screen action (server/index.ts
// bindTurnComputer), and the banner with Stop across the app
// (src/components/HostControlIndicator.tsx, GET /api/computer/host-control).

/** The conversation's line, as stored. The app shows it in the reader's
 * language (src/lib/activity-runs.ts); it is one of the notices the chat
 * keeps (shared/chat-notices.ts). */
export const HOST_CONTROL_NOTICE = "notice: The bot is now controlling this computer: its screen, mouse and keyboard. Stop it at any time with Stop.";

/** The computer seat a turn holds while it drives this computer. */
export const HOST_COMPUTER_RESOURCE = "computer:host";
