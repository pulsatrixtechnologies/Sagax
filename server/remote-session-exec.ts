// The approval rule for the bot's commands on a connected Tailcat session
// (remote_session_exec, remote_session_snapshot). The computer is a
// client's: a command that only reads (shared/read-only-command.ts, the same
// strict test as on the person's own computer, #875) runs without a card;
// any other command is the person's call every time: a card, never answered
// by a level, a rule or "Always allow". The fixed snapshot only reads.
import { isReadOnlyCommand, runCommandOf } from "../shared/read-only-command.ts";
import { builtinAgentToolName } from "./member-tool-scope.ts";

export interface RemoteSessionToolCall {
  /** One of the two remote session tools. */
  remote: boolean;
  /** It only reads: no card. */
  readOnly: boolean;
}

export function remoteSessionToolCall(tool: string | undefined, input: string | undefined): RemoteSessionToolCall {
  const name = builtinAgentToolName(tool?.trim());
  if (name === "remote_session_snapshot") return { remote: true, readOnly: true };
  if (name !== "remote_session_exec") return { remote: false, readOnly: false };
  return { remote: true, readOnly: isReadOnlyCommand(runCommandOf(input)) };
}
