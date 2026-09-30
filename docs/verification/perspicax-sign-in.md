# Sign in with Pulsatrix (Perspicax OpenID Connect)

An organization server (`OMB_IDENTITY=perspicax`, see
[self-hosting](../self-hosting.md#sign-in-with-pulsatrix-organization-server))
signs people in with Perspicax. Two levels of proof, both isolated: nothing
touches the user's app, `~/.openmausbot`, or a live Perspicax.

## Against a fake provider (automated)

```sh
pnpm exec vitest run server/oidc-rp.test.ts server/oidc-login.test.ts server/oidc-login.e2e.test.ts
node --test electron/oidc-login-window.node-test.mjs
```

`server/testing/fake-oidc-provider.ts` generates an ES256 key with
`node:crypto` and serves discovery, JWKS, authorize (signs the configured
person in at once), token (checks code, client, redirect URI and PKCE S256)
and revoke. The unit tests bend one thing at a time: bad signature, a key the
JWKS does not publish, `alg` other than ES256, wrong `aud`, `azp` or `iss`,
expiry and issue time outside 60 s, nonce mismatch or absence, state replay,
a callback in another browser, the wrong PKCE verifier, key rotation (one
JWKS refetch on an unknown `kid`), and the pending-flow limits.

The e2e test boots the real server with a temporary home against that
provider and the repository's fake engine, then proves: the environment
descriptor's `identity`, the sign-in walk and its cookie, `GET
/api/auth/session` (principal, email, name, role, orgRole), scenario A (an
admin creates a bot on the server, gets its answer, and a second browser of
the same person reads the thread), an employee's client-only session, refused
replays, foreign browsers and unknown roles, 403 on email codes and every
invitation route, and service loopback trust.

## Against a real Perspicax (manual)

Build Perspicax per its slice 1 contract and run it on a free port with a
throwaway config dir (never the operator's instances or
`~/.config/pulsatrix-connector`):

```sh
PX=$(mktemp -d)
cat > $PX/config.toml <<'EOF'
bind = "127.0.0.1:18787"
public_origin = "http://localhost:18787"
auth_mode = "local_oauth"
management = "gateway"
EOF
printf 'a-long-test-password\n' | pulsatrix-connector --config-dir $PX gateway init --admin alice --password-stdin --email alice@example.test
pulsatrix-connector --config-dir $PX local-auth enroll-totp alice > $PX/totp.txt   # keep the secret out of the terminal
PXC_PULSABOT_ORIGIN=http://localhost:18788 pulsatrix-connector --config-dir $PX serve
```

Then an isolated Pulsa Bot with a temporary home and the fake engine:

```sh
H=$(mktemp -d); mkdir -p $H/.openmausbot
echo '{"instances":{"grok":{"driver":"grokAgent","config":{"cli":"'$PWD'/server/testing/fake-acp-cli.ts","fullAuto":false}}}}' > $H/.openmausbot/config.json
env -i PATH="$PATH" HOME=$H OMB_PORT=18788 OMB_WEBHOOK_PORT=18789 \
  OMB_IDENTITY=perspicax OMB_PERSPICAX_ISSUER=http://localhost:18787 \
  OMB_PUBLIC_URL=http://localhost:18788 node server/index.ts
```

Open `http://localhost:18788/pair`, choose **Sign in with Pulsatrix**, enter
the password and a TOTP code on the Perspicax page, and land on the app. Check
`GET /api/auth/session` shows `identity: "perspicax"`, the principal, the
email and the role. A login access token (obtained by running the same code
flow by hand) must get 401 on `http://localhost:18787/mcp`: its audience is
the Pulsa Bot origin.

With real engines, the server runs turns on the engines installed where it
runs (the Docker image's `ENGINES` build argument) with the connection or key
an admin set in Settings, Connections; nothing runs on the signed-in person's
computer.

## Slice 2: the session lives on the grant

### Automated (fake provider)

```sh
pnpm exec vitest run server/oidc-rp.test.ts server/oidc-login.test.ts server/idp-session.test.ts \
  server/sessions.test.ts server/request-auth.test.ts server/principals.test.ts server/environment.test.ts \
  server/oidc-login.e2e.test.ts server/oidc-session.e2e.test.ts src/pair
node --test electron/oidc-login-window.node-test.mjs electron/environments.node-test.mjs
```

The fake provider now rotates refresh tokens (the old one dies), checks the
`resource`, returns an id_token without a nonce on refresh, revokes a whole
family, and signs back-channel logout tokens; `disable(sub)`,
`setRole(sub, role)` and `failNextToken(status)` drive the refusals.

- `server/oidc-rp.test.ts`: refresh (rotation, resource, a refreshed id_token
  for another subject or carrying a nonce, no id_token, invalid_grant as
  rejected, 503, 429 and an unreachable provider as transient), revocation,
  and the logout token matrix (another key, `alg: none`, unknown kid,
  another typ, aud, iss, no or past `exp`, `iat` in the future, no or wrong
  events, a nonce, no `jti`, sid only); an id_token is never a logout token
  and the reverse.
- `server/idp-session.test.ts`: the sealed vault (round trip, a file it
  cannot read is never overwritten, key from the environment, a key file or
  a 0600 default), refresh on use (not due, due, single flight), a rejected
  grant ending its sessions, a transient failure kept with a one minute
  backoff and ended after 24 hours, role changes (the grant's sessions take
  the new scopes, the person's other devices only narrow), release on
  logout and expiry, the sweep (unredeemed and orphan grants) and
  back-channel logout by subject and by principal.
- `server/oidc-login.test.ts`: the routes in process: the `client`
  parameter, the exact desktop and phone return links, no-store, and the
  back-channel route (405, wrong content type, oversized body, every forged
  token, 200 once then a replay refused).
- `server/oidc-session.e2e.test.ts` (real server, fake provider, fake engine,
  `OMB_OIDC_REFRESH_AFTER_SECONDS=1`): S2-1 refresh and rotation, S2-2 a role
  change narrows the session, S2-3 a back-channel logout ends the sessions
  and the open event stream at once, S2-5 logout revokes the grant, S2-6
  forged and replayed logout tokens, S2-7 the desktop return link redeemed
  once into a cookie session, S2-8 the phone return link redeemed into a
  bearer that a back-channel logout ends by principal, a disabled person's
  refresh ending the session, and a member pairing their own device.

### Against a real Perspicax (manual)

Start Perspicax and Pulsa Bot as above, with a short refresh period and, when
Perspicax should post to another address, its internal URL:

```sh
PXC_PULSABOT_ORIGIN=http://localhost:18788 pulsatrix-connector --config-dir $PX serve
env -i PATH="$PATH" HOME=$H OMB_PORT=18788 OMB_WEBHOOK_PORT=18789 \
  OMB_IDENTITY=perspicax OMB_PERSPICAX_ISSUER=http://localhost:18787 \
  OMB_PUBLIC_URL=http://localhost:18788 OMB_OIDC_REFRESH_AFTER_SECONDS=5 node server/index.ts
```

Then, with users `alice` (admin), `bob` (employee) and `carol` (admin) and an
admin console session for alice:

1. S2-1: sign bob in, wait 6 s, `GET /api/auth/session` answers 200 and
   Perspicax records `token_refreshed` for bob, client `pulsa-bot`.
2. S2-2: set carol to employee in Perspicax; after 6 s and one request her
   session shows `role: "employee"`, scopes `["client"]`, and
   `GET /api/auth/pairing` answers 403.
3. S2-3: with bob's event stream open, disable bob: within 3 s the stream
   ends and his session answers 401; Perspicax records `logout` ok. Enable
   him and sign in again: same `principalId`.
4. S2-4: `DELETE /api/v1/users/{bob}/sessions` ends bob's session within 3 s.
5. S2-5: alice logs out; Perspicax records `token_revoked` for her.
6. S2-6: forged logout tokens (another key, `alg: none`, wrong aud or iss,
   expired, no events, a nonce, an id_token) answer 400; a replayed valid
   one answers 400.
7. S2-7 and S2-8: in a browser with a throwaway profile, open
   `/auth/oidc/start?client=desktop` (and `?client=phone`), sign in, and read
   the `openmausbot://` address the browser is sent to; redeem it with
   `POST /api/auth/pair` (desktop) or `POST /api/pair` (phone) once.
8. S2-9: start a desktop flow and never redeem it: after about 3 minutes the
   sweep revokes the grant (`token_revoked`).
9. S2-10: stop Perspicax: requests still answer 200 and the server logs a
   deferred refresh; start it again and the next due refresh succeeds.

The desktop click-through (system browser and return) and the phone apps on
a device are checked by hand.

## Slice 3: the link, the directory and sharing with a person

### Automated (fake provider)

```sh
pnpm exec vitest run server/perspicax-link.test.ts server/engine-access.test.ts server/direct-grants.test.ts \
  server/principals.test.ts server/oidc-rp.test.ts server/oidc-login.test.ts server/idp-session.test.ts \
  server/request-auth.test.ts server/channel-visibility.test.ts server/org-sharing.e2e.test.ts \
  server/oidc-session.e2e.test.ts server/oidc-login.e2e.test.ts server/environment.test.ts server/wire.test.ts \
  src/components/bot-settings
```

The fake provider now serves `GET /api/v1/pulsabot/directory` behind its
link token (`linkToken`), with an ETag and 304, settable `directoryPeople`
and `directoryTeams`, and `setDirectoryStatus(sub, status)`.

- `server/perspicax-link.test.ts`: the link file (0644 refused, 0640 and
  0600 accepted, another issuer, origin or client, extra keys, a bad token,
  more than 4 KiB, and the token never in a refusal) and the directory sync
  (principals created before any sign-in, attributes updated, `disabledAt`
  never cleared, a disabled or vanished person logged out once, a demotion
  narrowed, 304, a 401 followed by a rotated file, single flight, a timeout
  or a 5xx keeping the last data).
- `server/engine-access.test.ts`: the whole access matrix (solo, an admin
  owner, someone else with and without the org key and a key-backed
  engine, a member's own bot and its routines, a missing engine first), the
  key_refused card and who sees its detail, and who answers a server
  command of a member's bot.
- `server/org-sharing.e2e.test.ts` (real server, fake provider, fake Claude
  CLI with `OMB_ANTHROPIC_API_KEY` and `FAKE_CLAUDE_DUMP`): S3-3 the
  directory before and after a sign-in, S3-11 the engines in the
  authenticated health, S3-4 a bot shared with bob answered with the
  organization key while dave sees nothing (list, thread, search, stream),
  S3-5 the grant removed ends bob's stream and access at once, S3-6 the
  no_access and engine_missing cards (and an admin's own login-backed bot
  still answering), S3-7 a member's bot refused full access, S3-10 a person
  disabled in the directory logged out with no back-channel push.

### Against a real Perspicax (manual)

Isolated instances only (never the live app or its data). Build
`pulsatrix-connector` from the slice 3 head and pick free ports, for
example Perspicax 19071 and Pulsa Bot 19072:

```sh
S=$(mktemp -d)
PXC_PULSABOT_ORIGIN=http://localhost:19072 PXC_PULSABOT_LINK_FILE=$S/link/pulsabot.json \
  pulsatrix-connector --config-dir $PX serve
env -i PATH="$PATH" HOME=$S/pbhome OMB_PORT=19072 OMB_WEBHOOK_PORT=19073 \
  OMB_IDENTITY=perspicax OMB_PERSPICAX_ISSUER=http://localhost:19071 \
  OMB_PUBLIC_URL=http://localhost:19072 OMB_OIDC_REFRESH_AFTER_SECONDS=5 \
  OMB_PERSPICAX_LINK_FILE=$S/link/pulsabot.json OMB_PERSPICAX_DIRECTORY_SECONDS=5 \
  OMB_ANTHROPIC_API_KEY=sk-ant-test-org-key FAKE_CLAUDE_DUMP=$S/claude-dump.json node server/index.ts
```

with `config.json` instances `claude` (claudeAgent, `cli` =
`server/testing/fake-claude-cli.ts`), `ghost` (claudeAgent, `cli` =
`/nonexistent/claude`) and `grok` (grokAgent, `server/testing/fake-acp-cli.ts`),
and accounts alice (admin), bob, dave and erin (employees). Then walk S3-1 to
S3-11 of the slice 3 plan: the link file (0640, six keys) and the auto link,
the link token scope, the directory before bob signs in, scenario B (share,
reply with `ANTHROPIC_API_KEY=sk-ant-test-org-key` in the dump, dave sees
nothing), scenario C (removal), scenario F (the cards, the owner's
`turn-failed` notification), the member bot rules, a link rotation picked up
within one directory period, unlink and relink, the directory as the
backstop when the back-channel push cannot arrive, and the engines in
`GET /api/health`.
