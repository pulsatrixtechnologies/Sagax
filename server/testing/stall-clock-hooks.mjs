// Explicit --import in isolated fixtures only: the verification launcher adds
// it when SAGAX_TEST_STALL_CLOCK=1 reaches it. The stall watchdog's window (its
// production twenty minutes of silence) elapses for every turn that is silent
// at that moment once the fixture writes <data dir>/stall-turns, and the
// watchdog sweeps every 50 ms instead of every minute, so a test can follow a
// stalled turn through its real course. A turn that speaks afterwards counts
// from then, as it would in production. It changes no authorization or
// dispatch decision.
import { registerHooks } from 'node:module';
import { join } from 'node:path';
const dataDir = process.env.SAGAX_DATA_DIR;
if (!dataDir || dataDir !== process.env.HOME || process.env.SAGAX_TEST_STALL_CLOCK !== '1') {
  throw new Error('The stall clock requires an explicitly isolated fixture');
}
const marker = join(dataDir, 'stall-turns');
const server = new URL('../index.ts', import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== server) return result;
    const source = String(result.source);
    // The watchdog is the server's only interval with this period.
    const anchor = 'checkMs: 60_000,';
    if (source.split(anchor).length !== 2) throw new Error('Stall watchdog clock seam changed');
    return { ...result, source: `import { existsSync as stallMarkerExists } from 'node:fs';\n` + source.replace(anchor,
      `checkMs: 50, now: () => Date.now() + (stallMarkerExists(${JSON.stringify(marker)}) ? TURN_STALL_MS : 0),`) };
  },
});
