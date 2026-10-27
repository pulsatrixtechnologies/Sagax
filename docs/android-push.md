# Android push notifications (FCM)

The server sends closed-app pushes to Android phones through Firebase Cloud
Messaging HTTP v1, next to APNs for iPhones (`docs/ios-push.md`).

## Server

Create a Firebase project, then a service account key (Project settings >
Service accounts > Generate new private key). Give the JSON to the server,
never to the repository:

- `SAGAX_FCM_SERVICE_ACCOUNT_PATH`: path to the JSON file (a read-only
  mount), or `SAGAX_FCM_SERVICE_ACCOUNT_JSON`: the JSON itself;
- `SAGAX_FCM_PROJECT_ID`: optional, else the JSON's `project_id`.

Unset, Android pushes are off with one log line; everything else works.
The server signs a short JWT, trades it for an access token (cached) and
posts a data message per device (`server/push/fcm.ts`). A token FCM no
longer knows (404, `UNREGISTERED`) is removed.

## App

The app starts Firebase by hand, only when the build carries the Firebase
Android app's four public identifiers (no `google-services.json` in the
repository):

```sh
SAGAX_FCM_ANDROID_APP_ID=... SAGAX_FCM_ANDROID_API_KEY=... \
SAGAX_FCM_PROJECT_ID=... SAGAX_FCM_SENDER_ID=... ./gradlew assembleRelease
```

(or the gradle properties `sagax.fcm.appId`, `.apiKey`, `.projectId`,
`.senderId`). Without them the app keeps its local notifications only.
With them it registers its token with `POST /api/push/devices
{ platform: "android" }` each time the session goes live, and
`SagaxMessagingService` posts the same notification a live stream would.
