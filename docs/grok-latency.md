# Grok turn latency: where the time goes

Measured on the production server (<HOST_FQDN>), 2026-10-11, main-e002b38d.

## Reading a turn from the logs

Every ACP turn logs one line when it settles (server/drivers/acp/turn-latency.ts):

    [turn-latency] grokAgent thread=800b207c path=pooled queue=99ms setup=21ms ttfa=1150ms ttft=1150ms tools=1 total=2111ms prompt=1655ch full=no in=18225 cached=16000 stallGuard=10000ms ok

- queue: the message was stored -> the engine took the turn (context, recall, place).
- setup: engine took it -> prompt sent (spawn, handshake, session/new or session/load, mode, model).
- ttfa / ttft: prompt -> first streamed update / first answer text. This is the provider.
- path: pooled (live session prompted as is), load (pooled process, session re-established; text turns rotate MCP tokens), spawn (new process).
- full: the prompt carried the whole system block (new session, changed stable half, re-anchor).
- in / cached: the provider's input tokens and the cached share.
- stallGuard: how long a silent prompt is given before Sagax cancels and asks once more.

`grep turn-latency` on the server log gives the distribution; the native wire log
($SAGAX_DATA_DIR/native/<thread>.ndjson) has every ACP message with its time.

## Baseline (Cryptic, Sagax approval gate on)

| Stage | New thread "pong" | Follow-up "pong" | One tool (list_bots) |
|---|---|---|---|
| queue | 183 ms | 99 ms | 72 ms |
| setup | 355 ms (spawn) | 21 ms (load) | 34 ms (load) |
| prompt -> first text | 1.58 s | 1.41 s | 1.15 s |
| tool call -> done | - | - | 43 ms |
| message stored -> reply stored | 2.26 s | 1.63 s | 2.23 s |

Same tool turn on a bot in Grok auto mode (no gate), new thread: 14.0 s = search_tool round 2.1 s
+ second round 3.6 s + auto-mode hold on use_tool 7.3 s + final round 0.9 s.

Fleet (179 prompts, 2026-10-11): first streamed update p50 2.4 s, p90 7.8 s, p99 37 s; auto-mode
permission holds p50 4.5 s (n=2274); session/new|load p50 0.22 s; spawn -> prompt p50 0.33 s;
17% of model rounds read under half of their prompt from cache (39% in the evening).

## Findings

- Streaming is end to end: deltas leave the server per ACP chunk, both Caddy layers flush
  (flush_interval -1; encode zstd/gzip still flushes per frame, checked with caddy 2.11.6), and the
  web and iOS clients render deltas as they arrive.
- The provider's cache is per session: a new session (new thread, routine run) reads ~0.5k of
  ~15k tokens from cache whatever the prompt; a session idle past the provider's cache lifetime
  misses too, so a long thread pays its whole context again (94-173k tokens: 8.7-19.8 s).
- Long threads are the slowest turns. Context size is set by Sagax's fold point (compactAt) and
  Grok's own auto_compact_threshold_percent; both trade memory of the thread for speed.
- The provider sometimes sends nothing for 27-90 s, on short contexts too. The stall guard now
  waits 10 s on a short conversation and up to 30 s on a long one (grokAdaptiveStallMs);
  SAGAX_GROK_STALL_RETRY_MS still fixes it (0 turns it off).
