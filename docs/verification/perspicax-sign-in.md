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
