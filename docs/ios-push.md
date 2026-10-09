# Push notifications for the phone app (APNs)

The phone app shows notifications by itself only while it runs or lingers in
the background with its live stream open. Once it is closed, or suspended
for long, only Apple Push Notification service (APNs) can reach it. The
organization server (Sagax in server mode, the `pulsabot` container on the
GOX VM) therefore sends real APNs pushes.

## What gets pushed

| Event | Push kind | When |
| --- | --- | --- |
| A person writes to you directly, a bot finishes a turn in your thread | `message` | Nobody saw it (below) |
| Someone nudges you | `nudge` | Always, at once, priority 10, the nudge sound |
| An approval, or a bot waiting on your answer | `approval` | Nobody saw it |
| A routine of yours failed | `routine` | Nobody saw it |
| An achievement unlocked | `achievement` | No client of yours is connected, and you turned on system notifications for achievements |

"Nobody saw it" is the desktop's own rule (`src/lib/attention.ts`,
`messageAttention`): notify unless you are looking at that conversation in a
focused window. The server does not know which conversation a window shows,
but a window that shows a conversation marks it read
(`POST /api/threads/:id/read`, `/api/groups/:id/read`, `/api/bots/:id/read`).
So when one of your clients is connected (presence), the push waits 8
seconds and is dropped if one of them marked that conversation read; when
none is connected it goes at once (`server/push/decide.ts`).

Each push follows:

- the phone's Settings > Notifications (notification sounds, nudge sound),
  sent with each registration;
- the person's synced "Notification sounds";
- a bot's notifications muted for that person (Settings of the bot);
- a rate limit of 20 pushes per person in 5 minutes;
- one notification per conversation (`apns-collapse-id` is
  `sagax.t.<threadId>`, the same identifier as the app's local
  notification, so a push replaces the banner the live stream already showed).

The alert text of a message is the message itself (clipped to 240
characters): it travels through Apple to the phone like any messaging app.

## Code

- `server/push/config.ts`: the `SAGAX_APNS_*` settings.
- `server/push/jwt.ts`: the provider token (JWT ES256 signed with the `.p8`,
  renewed every 40 minutes).
- `server/push/payload.ts`: the APNs body and headers.
- `server/push/apns.ts`: HTTP/2 to APNs with Node's `http2`, no dependency.
- `server/push/devices.ts`: each person's devices in
  `<data>/push-devices/<principal>.json` (mode 0600). A device APNs answers
  410 Unregistered, or 400 BadDeviceToken / DeviceTokenNotForTopic, is
  removed.
- `server/push/frames.ts`, `server/push/hub.ts`: which live frames become
  pushes, the decision, the sends.
- `server/routes/push-devices.ts`: `POST`, `GET`, `DELETE /api/push/devices`
  (the signed-in person's own devices only; tokens are masked in every
  answer and every log line).
- `ios/Sources/CompanionCore/Push.swift`, `ios/App/PushRegistrar.swift`: the
  phone registers its token with the server it is signed in to at every
  launch, when the token changes, when another server becomes active and
  when Settings > Notifications changes; it removes it on sign-out. A tap
  opens the conversation; a nudge received in front shakes and rings like
  the in-app nudge, once; a push wakes the app for a moment
  (`content-available`) to recount the icon badge.

The APNs hosts appear only in the server bundle: `check:no-phone-home`
refuses `api.push.apple.com` and `api.sandbox.push.apple.com` everywhere
except the server's host table in `dist-server/`.

## Creating the APNs key (once, Apple Developer portal)

1. Sign in to https://developer.apple.com/account with the Pulsatrix team
   (Team ID `PP546MZVHZ`).
2. Certificates, Identifiers & Profiles > **Keys** > **+**.
3. Name it (for example `Sagax APNs`), check **Apple Push Notifications
   service (APNs)**, Configure: environment **Sandbox & Production**, then
   Continue and Register.
4. **Download** the `AuthKey_XXXXXXXXXX.p8` file. Apple lets you download it
   only once: keep it in the password vault.
5. Note the **Key ID** (10 characters, shown on the key's page and in the
   file name).
6. Identifiers > `ca.pulsatrix.sagax`: check that **Push Notifications** is
   enabled (Xcode's automatic signing usually turns it on with the
   `aps-environment` entitlement; check after the next archive).

Important: an APNs key is **not** the App Store Connect API key, even though
both are `.p8` files from the same account. The App Store Connect key
(Users and Access > Integrations, used by `asc` and `altool`) signs tokens
APNs does not accept: APNs answers **403 InvalidProviderToken**. The server
logs that case once with this hint.

TestFlight and App Store builds use the **production** APNs environment.
Only a build run from Xcode on a device uses sandbox. The phone sends its own
environment when it registers and that one wins over
`SAGAX_APNS_ENVIRONMENT`. One APNs key serves both environments.

## Server settings

| Variable | Value |
| --- | --- |
| `SAGAX_APNS_KEY_PATH` | the `.p8` file, mounted read-only |
| `SAGAX_APNS_KEY_ID` | the 10 character Key ID |
| `SAGAX_APNS_TEAM_ID` | `PP546MZVHZ` (the default) |
| `SAGAX_APNS_BUNDLE_ID` | `ca.pulsatrix.sagax` (the default) |
| `SAGAX_APNS_ENVIRONMENT` | `production` (the default) or `sandbox` |

Without `SAGAX_APNS_KEY_PATH` and `SAGAX_APNS_KEY_ID` the server sends
nothing: phones still register, and the first push that would have gone out
logs one line `push: APNs is not configured (...)`; after that, quiet. With
them, startup logs `push: APNs on (...)`.

## On the GOX VM (Perspicax infra)

The `pulsabot` container already reads its secrets from
`/opt/pulsatrix/secrets/pulsabot` (mounted at `/run/secrets/pulsabot`, files
`root:10002` mode 0440, the container has group 10002), filled by
`infra/scripts/vm-bootstrap.sh` from the Key Vault. The APNs key follows the
same path. These changes belong to the Perspicax repository and are applied
by the orchestrator, not by this pull request.

1. Put the key in the Key Vault (isolated `az` profile of Perspicax):

   ```sh
   export AZURE_CONFIG_DIR=~/.azure-pulsatrix
   vault=$(az keyvault list --resource-group rg-pulsatrix-gox --query '[0].name' -o tsv)
   az keyvault secret set --vault-name "$vault" --name sagax-apns-key-p8 \
     --file AuthKey_XXXXXXXXXX.p8 --encoding base64 --output none
   az keyvault secret set --vault-name "$vault" --name sagax-apns-key-id \
     --value XXXXXXXXXX --output none
   ```

2. `infra/runtime/docker-compose.yml`, service `pulsabot`, under
   `environment:` (after `SAGAX_GITHUB_CLIENT_ID`):

   ```yaml
      # APNs pushes to the Sagax phone app (Sagax docs/ios-push.md). The key
      # file is written by vm-bootstrap.sh from the Key Vault; an empty
      # SAGAX_APNS_KEY_ID means no pushes (one log line).
      SAGAX_APNS_KEY_PATH: /run/secrets/pulsabot/apns_key.p8
      SAGAX_APNS_KEY_ID: ${SAGAX_APNS_KEY_ID:-}
      SAGAX_APNS_TEAM_ID: PP546MZVHZ
      SAGAX_APNS_BUNDLE_ID: ca.pulsatrix.sagax
      SAGAX_APNS_ENVIRONMENT: production
   ```

3. `infra/scripts/vm-bootstrap.sh`, inside the Sagax "on" branch, right
   after the `cat >>"$env_file" <<ENV ... ENV` block that writes
   `SAGAX_IDP_VAULT_KEY_FILE`:

   ```bash
     # APNs key for pushes to the Sagax phone app (optional). Key Vault:
     # sagax-apns-key-p8 (the .p8, base64) and sagax-apns-key-id. Written
     # root:10002 0440 like idp_key; never in .env, Compose or a log.
     apns_key_file=$pulsabot_secrets_dir/apns_key.p8
     apns_key_b64=$(optional_secret sagax-apns-key-p8)
     apns_key_id=$(optional_secret sagax-apns-key-id)
     if [[ -n "$apns_key_b64" && "$apns_key_id" =~ ^[A-Z0-9]{10}$ ]]; then
       printf '%s' "$apns_key_b64" | base64 --decode >"$apns_key_file"
       chown root:10002 "$apns_key_file"
       chmod 0440 "$apns_key_file"
       printf 'SAGAX_APNS_KEY_ID=%s\n' "$apns_key_id" >>"$env_file"
       echo "Sagax: APNs pushes on (key $apns_key_id)"
     else
       rm -f "$apns_key_file"
       echo "Sagax: APNs pushes off (no sagax-apns-key-p8 and sagax-apns-key-id in the Key Vault)"
     fi
     unset apns_key_b64
   ```

4. Deploy as usual (snapshot first), then check the container log for
   `push: APNs on (production by default, topic ca.pulsatrix.sagax, ...)`.

## Checking it end to end

Nothing can be checked end to end without the real key. With the key on the
VM and a TestFlight build:

1. Open the app signed in to GOX once (it registers: `GET /api/push/devices`
   lists the phone, token masked).
2. Close the app (swipe it away), then from another account send a direct
   message, then a nudge. The phone shows both; the nudge plays the nudge
   sound. A tap opens the conversation.
3. Keep the desktop app open on that conversation while a message arrives:
   no push.
4. The server log shows no `InvalidProviderToken`. If it does, the `.p8` is
   the App Store Connect key, or the Key ID or Team ID is wrong.
