// The composer lab (WP3 UI tests, ios/UITests/ComposerPowerUITests.swift),
// on the fixture's front (the computer double), next to the card lab. It
// only refuses sends on request, so a test can see the app's failed-send
// banner and its Retry deliver; every other request reaches the real server.
//
//   GET  /__parity/composer             -> { failNext, refused }
//   POST /__parity/composer/fail-sends  {count} -> the next `count` message
//                                          POSTs answer 503 before the server
//
// Production code never sees it.
const lab = { failNext: 0, refused: [] };

const SEND = /^\/api\/(bots|groups)\/[\w-]+\/messages$/;

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

/** Handles /__parity/composer* and refused sends; false for anything else. */
export async function composerLabHook(req, res, url) {
  if (url.pathname === "/__parity/composer" && req.method === "GET") {
    sendJson(res, 200, lab);
    return true;
  }
  if (url.pathname === "/__parity/composer/fail-sends" && req.method === "POST") {
    const body = await readJson(req);
    lab.failNext = Math.max(0, Number(body.count ?? 1) | 0);
    sendJson(res, 200, lab);
    return true;
  }
  if (lab.failNext > 0 && req.method === "POST" && SEND.test(url.pathname)) {
    lab.failNext -= 1;
    lab.refused.push({ path: url.pathname, at: Date.now() });
    // drain the body so the client sees a clean answer
    for await (const _ of req) { /* discard */ }
    sendJson(res, 503, { error: "The parity fixture refused this send." });
    return true;
  }
  return false;
}
