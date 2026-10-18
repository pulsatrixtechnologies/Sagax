import { describe, expect, it } from "vitest";

import de from "../../locales/de.json";
import en from "../../locales/en.json";
import es from "../../locales/es.json";
import fr from "../../locales/fr.json";
import hi from "../../locales/hi.json";
import ja from "../../locales/ja.json";
import ptBr from "../../locales/pt-br.json";
import uk from "../../locales/uk.json";
import zh from "../../locales/zh.json";
import zhTw from "../../locales/zh-tw.json";
import { CALL_FAILURE_GRACE_MS, CallFailure, callFailureKey, callFailureKind, failedRowKind, type FailureRow } from "./failure";

const said = (id: string, text = "Is the backup done?"): FailureRow => ({ id, role: "user", kind: "text", text });
const failed = (id: string, cause: string, setup = false): FailureRow => ({ id, role: "bot", kind: "activity", tool: { name: `error: ${cause}`, ...(setup ? { setup } : {}) } });
const reply = (id: string, text = "Yes, it finished."): FailureRow => ({ id, role: "bot", kind: "text", text });
const idle = { botBusy: false, botSpeaking: false, awaitingAnswer: false };

describe("a failed turn on a call", () => {
  it("sorts the cause into a kind, never reading it", () => {
    expect(callFailureKind("API Error: 529 {\"type\":\"overloaded_error\"}")).toBe("busy");
    expect(callFailureKind("429 Too Many Requests")).toBe("busy");
    expect(callFailureKind("insufficient_quota: You exceeded your current quota")).toBe("quota");
    expect(callFailureKind("Invalid API key · Please run /login")).toBe("signIn");
    expect(callFailureKind("anything", { setup: true })).toBe("signIn");
    expect(callFailureKind("fetch failed: ECONNRESET")).toBe("connection");
    expect(callFailureKind("The operation timed out")).toBe("connection");
    expect(callFailureKind("claude exited 3 before result")).toBe("generic");
    expect(callFailureKind("Claude AI usage limit reached|1760000000")).toBe("limit");
    expect(callFailureKind("Your credit balance is too low")).toBe("quota");
    expect(callFailureKind("HTTP 502 Bad Gateway")).toBe("connection");
    expect(callFailureKind("OAuth token has expired")).toBe("signIn");
  });

  it("never sorts a cause by a word that only looks like one", () => {
    expect(callFailureKind("max_tokens 512 is above the model limit")).toBe("generic");
    expect(callFailureKind("code signing failed for the bundle")).toBe("generic");
    expect(callFailureKind("logging in debug mode crashed")).toBe("generic");
    expect(callFailureKind("the certificate expired")).toBe("generic");
    expect(callFailureKind("context window capacity exceeded")).toBe("generic");
    expect(callFailureKind("line 540: unexpected token")).toBe("generic");
    expect(callFailureKind("500 tokens left in the window")).toBe("generic");
    expect(callFailureKind("Rate limit reached for requests")).toBe("busy");
  });

  it("is a failed row only for an error or access row, never a stop", () => {
    expect(failedRowKind(failed("a", "socket hang up"))).toBe("connection");
    expect(failedRowKind({ id: "b", role: "bot", kind: "access", text: "Not on this server." })).toBe("generic");
    expect(failedRowKind({ id: "c", role: "bot", kind: "activity", tool: { name: "Read file" } })).toBeNull();
    expect(failedRowKind(failed("d", "Request was aborted."))).toBeNull();
    expect(failedRowKind(reply("e"))).toBeNull();
  });

  it("waits out the harness's retry, then says it once", () => {
    const watch = new CallFailure();
    const messages = [said("u1"), failed("f1", "API Error: 529 overloaded")];
    expect(watch.next({ now: 0, messages, ...idle })).toBeNull();
    expect(watch.next({ now: CALL_FAILURE_GRACE_MS - 1, messages, ...idle })).toBeNull();
    expect(watch.next({ now: CALL_FAILURE_GRACE_MS, messages, ...idle })).toBe("busy");
    // then silence
    expect(watch.next({ now: CALL_FAILURE_GRACE_MS * 3, messages, ...idle })).toBeNull();
  });

  it("says nothing when the retry answers", () => {
    const watch = new CallFailure();
    expect(watch.next({ now: 0, messages: [said("u1"), failed("f1", "ECONNRESET")], ...idle })).toBeNull();
    // the retry runs
    expect(watch.next({ now: 3_000, messages: [said("u1"), failed("f1", "ECONNRESET")], ...idle, botBusy: true })).toBeNull();
    const answered = [said("u1"), failed("f1", "ECONNRESET"), reply("r1")];
    expect(watch.next({ now: 9_000, messages: answered, ...idle })).toBeNull();
  });

  it("a retry that fails too is said once, for its newest failure", () => {
    const watch = new CallFailure();
    watch.next({ now: 0, messages: [said("u1"), failed("f1", "ECONNRESET")], ...idle });
    const twice = [said("u1"), failed("f1", "ECONNRESET"), failed("f2", "Invalid API key")];
    expect(watch.next({ now: 5_000, messages: twice, ...idle })).toBeNull();
    expect(watch.next({ now: 5_000 + CALL_FAILURE_GRACE_MS, messages: twice, ...idle })).toBe("signIn");
    // a third failure on the same words stays silent
    const thrice = [...twice, failed("f3", "ECONNRESET")];
    expect(watch.next({ now: 60_000, messages: thrice, ...idle })).toBeNull();
    expect(watch.next({ now: 90_000, messages: thrice, ...idle })).toBeNull();
    // new words that fail are said again
    const next = [...thrice, said("u2"), failed("f4", "ECONNRESET")];
    watch.next({ now: 100_000, messages: next, ...idle });
    expect(watch.next({ now: 100_000 + CALL_FAILURE_GRACE_MS, messages: next, ...idle })).toBe("connection");
  });

  it("waits out a retry that starts late (warm-up), never saying both", () => {
    const watch = new CallFailure();
    const messages = [said("u1"), failed("f1", "ECONNRESET")];
    watch.next({ now: 0, messages, ...idle });
    // the retry is busy only from 3.9 s on
    expect(watch.next({ now: 3_900, messages, ...idle })).toBeNull();
    expect(watch.next({ now: 4_000, messages, ...idle, botBusy: true })).toBeNull();
    expect(watch.next({ now: 9_000, messages: [...messages, reply("r1")], ...idle })).toBeNull();
  });

  it("skips words another bot asked, as the harness does", () => {
    const watch = new CallFailure();
    const messages: FailureRow[] = [said("u1"), reply("r0"), { ...said("p1"), peerAsk: { botId: "b2" } }, failed("f1", "ECONNRESET")];
    watch.next({ now: 0, messages, ...idle });
    expect(watch.next({ now: CALL_FAILURE_GRACE_MS, messages, ...idle })).toBeNull();
  });

  it("never talks over the bot, the person, or an open question", () => {
    const watch = new CallFailure();
    const messages = [said("u1"), failed("f1", "boom")];
    watch.next({ now: 0, messages, ...idle });
    const late = CALL_FAILURE_GRACE_MS + 1;
    expect(watch.next({ now: late, messages, ...idle, botBusy: true })).toBeNull();
    expect(watch.next({ now: late, messages, ...idle, botSpeaking: true })).toBeNull();
    expect(watch.next({ now: late, messages, ...idle, awaitingAnswer: true })).toBeNull();
    const open = [...messages, { id: "q1", role: "bot", kind: "options", card: { requestId: "req-1" } }];
    expect(watch.next({ now: late, messages: open, ...idle })).toBeNull();
    expect(watch.next({ now: late, messages, ...idle })).toBe("generic");
  });

  it("ignores what was on screen when the call started", () => {
    const before = [said("u0"), failed("f0", "ECONNRESET")];
    const watch = new CallFailure(before);
    expect(watch.next({ now: 0, messages: before, ...idle })).toBeNull();
    expect(watch.next({ now: 60_000, messages: before, ...idle })).toBeNull();
  });

  it("has one plain sentence per kind in every language the progress lines speak, never a code", () => {
    for (const kind of ["busy", "limit", "quota", "signIn", "connection", "generic"] as const) {
      for (const catalog of [en, fr, de, es, hi, ja, ptBr, uk, zh, zhTw] as Array<Record<string, string>>) {
        const line = catalog[callFailureKey(kind)];
        expect(line).toBeTruthy();
        expect(line).not.toMatch(/\d{3}|error|erreur|https?:/i);
      }
    }
  });
});
