// Email drafts sent from their card (shared/email-draft-send.ts has the
// rules): the approval card's fields, the one-shot passes a bot's own mail
// connector uses after the person's Allow, and the server's own send.
//
// A send never starts here without the person's Allow on that card: the
// route only writes the card; `sendWithMailer` and `grant` run from the
// card's Allow (server/index.ts resolveAndSendEmailDraft).

import { randomUUID } from "node:crypto";

import {
  EMAIL_SEND_PASS_MS,
  EMAIL_SEND_REQUEST_PREFIX,
  emailSendCallMatches,
  type EmailConnector,
  type EmailDraftToSend,
  type EmailSendRequestCard,
} from "../shared/email-draft-send.ts";
import type { Mailer } from "./mailer.ts";
import { redactSecrets } from "./redact.ts";

export function emailSendCard(input: { draft: EmailDraftToSend; draftKey: string; connector: EmailConnector; by: string; now?: number }): EmailSendRequestCard {
  return {
    id: `${EMAIL_SEND_REQUEST_PREFIX}${randomUUID()}`,
    draftKey: input.draftKey,
    draft: input.draft,
    connector: input.connector,
    by: input.by,
    status: "pending",
    at: input.now ?? Date.now(),
  };
}

interface Pass {
  requestId: string;
  draft: EmailDraftToSend;
  expires: number;
}

export interface EmailSendPasses {
  grant(threadId: string, requestId: string, draft: EmailDraftToSend): void;
  /** The pass this outbound call uses, removed; null when the call is not the
   * approved draft. */
  take(threadId: string, tool: string, input: string | undefined): { requestId: string } | null;
  /** Whether an outbound call is an approved draft, without using the pass. */
  matches(threadId: string, tool: string, input: string | undefined): boolean;
  /** Whether this request's pass is still waiting (not used, not lapsed). */
  waiting(threadId: string, requestId: string): boolean;
  revoke(threadId: string, requestId: string): void;
}

export function createEmailSendPasses(now: () => number = Date.now): EmailSendPasses {
  const passes = new Map<string, Pass[]>();
  const live = (threadId: string): Pass[] => {
    const kept = (passes.get(threadId) ?? []).filter((pass) => pass.expires > now());
    if (kept.length) passes.set(threadId, kept);
    else passes.delete(threadId);
    return kept;
  };
  return {
    grant(threadId, requestId, draft) {
      passes.set(threadId, [...live(threadId).filter((pass) => pass.requestId !== requestId), { requestId, draft, expires: now() + EMAIL_SEND_PASS_MS }]);
    },
    take(threadId, tool, input) {
      const list = live(threadId);
      const index = list.findIndex((pass) => emailSendCallMatches(pass.draft, tool, input));
      if (index < 0) return null;
      const [pass] = list.splice(index, 1);
      if (list.length) passes.set(threadId, list);
      else passes.delete(threadId);
      return { requestId: pass!.requestId };
    },
    matches(threadId, tool, input) {
      return live(threadId).some((pass) => emailSendCallMatches(pass.draft, tool, input));
    },
    waiting(threadId, requestId) {
      return live(threadId).some((pass) => pass.requestId === requestId);
    },
    revoke(threadId, requestId) {
      const list = live(threadId).filter((pass) => pass.requestId !== requestId);
      if (list.length) passes.set(threadId, list);
      else passes.delete(threadId);
    },
  };
}

/** The server's own mail sends the draft. A refusal comes back readable and
 * without any credential. */
export async function sendWithMailer(mailer: Mailer | null, draft: EmailDraftToSend): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!mailer) return { ok: false, error: "The server's mail is not set up (Settings > Email)." };
  try {
    await mailer.send({
      to: draft.to.join(", "),
      subject: draft.subject,
      text: draft.body,
      ...(draft.cc.length ? { cc: draft.cc } : {}),
      ...(draft.bcc.length ? { bcc: draft.bcc } : {}),
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: String(redactSecrets(message)).slice(0, 400) };
  }
}
