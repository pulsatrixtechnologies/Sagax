# Releasing

> **Sagax updater:** installed apps update only from
> `pulsatrixtechnologies/sagax` releases tagged `pulsa-vX.Y.Z`
> (`electron/update-feed.mjs`). By default they look at the latest **full**
> release (`/releases/latest`); a GitHub pre-release is offered only to people
> who switched on Settings > General > Pre-release versions. Publish a
> version everyone should get (starting with 0.4.0) as a full release, not a
> pre-release; the fork release workflow's `prerelease` input defaults to off.

For a normal release, run **Actions → Prepare next release → Run workflow** and
choose a patch, minor, or custom version. It opens a tiny version-bump PR;
merging that PR automatically starts **Release** and assembles a draft from the
exact merge commit. Review and publish the draft when it is ready.

The existing **Actions → Release → Run workflow** button remains available for
reruns and recovery. It
builds macOS (arm64 + x64, signed, notarized, stapled), Windows, and Ubuntu
from a single pinned commit, verifies every artifact the way a user would
receive it, and assembles the canonical draft in
[Sagax releases](https://github.com/pulsatrixtechnologies/sagax/releases).
The exact same assets are also staged in the public legacy releases repo so
installed builds from 0.1.46 and earlier can update across the repository
migration.

Tick **publish** to publish and verify the canonical release first, then make
the identical legacy updater bridge visible. Leave it unticked to review the
canonical draft; when you publish that draft in GitHub's UI, the **Sync
published release** workflow
verifies and publishes its legacy mirror automatically. Never publish only the
legacy draft.

The release commit must have passed CI: the **CI passed on the release commit**
job waits (while the platforms build) for ci.yml's `CI` check on the pinned
commit and stops the release before any draft if it failed, was cancelled or
never ran. For a manual run on a commit without a CI run, run **Actions → CI →
Run workflow** on it first. `ship_without_ci` skips the wait, for emergencies
only.

The workflow refuses to overwrite an already-published version. Manual Release
runs still require `package.json`'s version to be bumped on the selected ref.
A release is rejected if any installer, stable download
name, updater feed, blockmap, size, or digest is absent or inconsistent.

GitHub generates the release body from pull requests since the previous
canonical tag. The docs changelog combines published canonical releases with
the legacy archive into one complete history and caches it for five minutes.
Configure the optional Vercel hook below to rebuild the docs immediately after
publication; otherwise the live cache or the next normal docs deployment
refreshes it.

## Sagax local release (no GitHub Actions)

Sagax releases are built on a Mac, not by the workflows above:

1. Set `forkVersion` in `package.json` (`version` stays the OpenMausBot base)
   and write `docs/releases/X.Y.Z.md`.
2. macOS: `SAGAX_MAC_IDENTITY="<Developer ID name or SHA-1 hash>" pnpm package:fork:mac`
   (a hash is required when the keychain holds two identities with the same
   name), then notarize and staple each `.zip`/`.dmg`, re-zip and regenerate
   `latest-mac.yml` (`node scripts/regenerate-mac-feed.mjs`).
3. Windows x64 + arm64: `pnpm package:fork:win:cross` (one NSIS installer for
   both arches, two portable zips, `latest.yml`). After-pack refuses a
   package whose `.node` addons or `Sagax.exe` are not PE images for that
   arch; recheck a built or downloaded package with
   `node scripts/verify-win-natives.mjs <win-unpacked or unzipped dir> x64|arm64`.
   Nothing here runs the app: a Windows launch is still needed before release.
4. Gates: `scripts/smoke-browser-bundle.mjs` (live on the host arch,
   `--check-only` for the others) and `SAGAX_SMOKE_DIST=<resources>/server
   node scripts/smoke-packaged-server.mjs` for every package.
5. `gh release create pulsa-vX.Y.Z` with every installer, zip, blockmap and
   both feeds, as a full release.

## Updater migration invariant

`app-update.yml` is baked into every packaged desktop app. Builds through
0.1.46 point to `milind-soni/openmausbot-releases`; newer builds point to
`pulsatrixtechnologies/sagax`. For that reason:

1. Every new release is published byte-for-byte to both repositories during
   the bridge period.
2. `openmausbot-releases` must stay public. Do not delete its final bridge
   release, feeds, or assets.
3. README and docs downloads point at the canonical repo, while the legacy
   mirror exists only for installed updater clients and historical releases.

The npm package is published separately and its versioned `.tgz` is attached
only to the canonical release. It is not a desktop updater artifact; the
mirror checks permit that one extra file while still verifying the complete,
byte-identical desktop asset set.

## Why the gates exist

Each verification step in `release.yml` maps to a real incident from the
hand-cut releases (0.1.15–0.1.25): stale build output breaking the code
signature, a bare import killing the packaged server on launch while every
check stayed green, helper paths resolving outside the app after bundling,
stapling silently invalidating every published hash, and a finished release
sitting invisible as a draft. Don't remove a gate without reading the comment
above it.

## Bundled browser gates

Desktop builds also stage a pinned engine and Chromium Headless Shell before
packaging. Pre-signing checks validate complete resources and upstream hashes;
native browser smoke tests and macOS signature checks run on the packaged
output. See [browser packaging](browser-packaging.md) for update ownership,
license provenance and Linux sandbox constraints. Missing browser resources
must fail the build, not ship an installer that downloads them on first use.

## One-time setup: release secrets

Set these in **Sagax → Settings → Secrets and variables → Actions**.

The **Prepare next release** workflow also needs
**Settings → Actions → General → Workflow permissions → Allow GitHub Actions
to create and approve pull requests** enabled. The workflow only creates the
version PR; it never approves or merges it.

### 1. `MAC_CERT_P12_BASE64` + `MAC_CERT_PASSWORD`

The Developer ID Application certificate, exported from the Mac that
currently signs releases:

```sh
# Keychain Access → My Certificates → "Developer ID Application: Milind Soni
# (993D98NH4J)" → right-click → Export… → .p12 with a strong password, then:
base64 -i DeveloperID.p12 | pbcopy   # → MAC_CERT_P12_BASE64
# the export password             → MAC_CERT_PASSWORD
```

### 2. `APPLE_API_KEY_P8_BASE64` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER_ID`

An App Store Connect API key for notarization (better than an app-specific
password for CI — revocable, scoped, no 2FA dance):

1. [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
2. Generate a **Team Key** with the **Developer** role
3. Download the `.p8` (one chance only), note the Key ID and Issuer ID

```sh
base64 -i AuthKey_XXXXXXXX.p8 | pbcopy   # → APPLE_API_KEY_P8_BASE64
```

### 3. `RELEASES_PAT`

A fine-grained personal access token that lets the workflow write to the
legacy updater mirror: **GitHub → Settings → Developer settings →
Fine-grained tokens** → repository access: only `openmausbot-releases` →
permissions: **Contents: Read and write**. Set a long expiry and a calendar
reminder. The canonical release uses the workflow's scoped `GITHUB_TOKEN` and
does not need a PAT.

### 4. Optional `DOCS_DEPLOY_HOOK_URL`

In Vercel, open the docs project and create a **Deploy Hook** for its production
branch. Store that private URL as the `DOCS_DEPLOY_HOOK_URL` repository secret.
Publishing a release then requests a fresh docs deployment so the generated
changelog appears immediately. Do not put the hook URL in source control.

### Local fallback

The hand-cut path still works when Actions is down or a release needs
surgery: `pnpm package:mac`, gate with `codesign --verify --deep --strict`,
notarize with the local keychain profile (`xcrun notarytool submit …
--keychain-profile AC_PASSWORD`), staple, re-zip, regenerate blockmaps and
`node scripts/regenerate-mac-feed.mjs`, upload the identical complete asset set
to both repositories, publish and verify the canonical release before the
legacy mirror, and always verify the published bytes against the published feed
by downloading them back.
