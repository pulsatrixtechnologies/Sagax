# Edition loading

This distribution does not include the source-available `enterprise/`
directory. `server/enterprise.ts` reports `{"edition":"oss"}` when that
directory is absent. A license key with no layer does not unlock features.

## Sub-features

- A checkout, npm package, Docker image, and packaged desktop ship without
  `enterprise/`. `OMB_ENTERPRISE_DIR`, when set, is the only place looked at,
  and a missing directory stays the open-source edition.
- From 30 days before a key expires: `expiresInDays` on `/api/edition`, a
  warning in the startup log, and a banner in Settings for admins. The dates
  reach admin sessions only: a member's `/api/edition` and config leave out
  `expiresInDays`, `graceEndsAt` and the notice.
- For 7 days after it expires the entitlements keep working, with a notice,
  `graceEndsAt` on `/api/edition`, and a banner saying until when. Then they
  stop, without a restart. The key format and signature check are unchanged.

## Driving it

```sh
pnpm exec vitest run server/enterprise.test.ts server/brand.test.ts
```

`server/enterprise.test.ts` checks the open-source edition when the directory
is absent, including a key that was set anyway. It can still load a temporary
stand-in `register()` to prove the seam. It does not vendor the removed
layer. The Docker workflow boots the image with a non-genuine key and expects
`edition: oss` plus `no enterprise layer exists`.

## Gotchas

- Tested on 2026-09-23 against disposable fixtures only: stand-in layers,
  throwaway signing keys and a temporary home. No real license key, hosted
  tenant or cloud Admin was involved; this is not production qualification.
- The cloud Admin's own license check (`verifyLicenseKey` called directly) has
  no grace period; only the OMB server's `register()` path does.
- The Settings banner is proven from fixtures in
  `src/components/LicenseExpiryBanner.test.ts`, not driven headlessly.
