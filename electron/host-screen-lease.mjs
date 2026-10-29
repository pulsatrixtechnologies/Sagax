// The lock a lent screen call takes on this computer's own screen, through
// the desktop's own server (/api/desktop/shared-computer-control). Each
// refusal says what really happened: the server's own reason when it
// refused (another bot, a person's takeover, an organization's policy), and
// otherwise that the check itself failed, which is never a person.

const KNOWN_REFUSALS = new Set(["screen_bot", "screen_person", "managed_policy"]);

export function screenCheckFailedText(what) {
  return `Sagax on this computer could not check whether its screen is free (${what}), so this call was not performed. This is not a person using the computer. Try again in a few seconds; if it keeps happening, tell the person to quit and reopen Sagax on that computer.`;
}

/**
 * @param {{
 *   fetch: (url: string, init: RequestInit) => Promise<Response>,
 *   url: () => string,
 *   headers: () => Record<string, string>,
 *   timeoutMs?: number,
 * }} options
 */
export function createHostScreenLease({ fetch, url, headers, timeoutMs = 3000 }) {
  async function post(id, action, signal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetch(url(), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ id, action }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      // The call's own stop is passed on as it is.
      if (signal?.aborted) throw signal.reason ?? error;
      throw new Error(screenCheckFailedText(timeout.aborted
        ? `its server did not answer within ${Math.round(timeoutMs / 1000)} seconds`
        : "its server could not be reached"));
    }
    const body = await response.json().catch(() => null);
    if (response.ok) return body ?? {};
    if ((response.status === 409 || response.status === 403) && KNOWN_REFUSALS.has(body?.code) &&
        typeof body?.error === "string" && body.error.trim() && body.error.length <= 1_000) {
      throw Object.assign(new Error(body.error), { code: body.code });
    }
    throw new Error(screenCheckFailedText(`its server answered ${response.status}`));
  }

  /** Take the screen for one lent call; renew keeps it, release lets go. */
  return async function hostControl(id, signal) {
    await post(id, "acquire", signal);
    return {
      // A lease that expired or was freed is taken again, with every check,
      // rather than acting without it.
      renew: async () => {
        const answer = await post(id, "renew", signal);
        if (answer?.renewed === false) await post(id, "acquire", signal);
      },
      release: () => post(id, "release"),
    };
  };
}
