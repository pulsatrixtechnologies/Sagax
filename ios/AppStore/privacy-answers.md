# App Privacy answers (App Store Connect)

Verified against the iOS code on branch `docs/ios-external-beta`
(MARKETING_VERSION 0.5.8, build 37) on 2026-10-16. Re-check before every
upload, especially if analytics, crash reporting, a hosted relay or a new
third-party service is added. The public policy is `docs/ios-privacy.md`.

## How to read this

Apple counts data as **collected** when it leaves the device and the
developer (or its partners) can access it for longer than needed to serve
the request in real time. Sagax sends data to two kinds of destination:

- **The person's own computer** (QR pairing). Pulsatrix never receives it.
- **An organization's Sagax server** (Pulsatrix sign-in). Each client
  organization runs its own server, with its own keys (xAI, APNs) and its
  own policies: the organization is the controller of that data, not
  Pulsatrix (decision of JC, 2026-10-16). Pulsatrix operates no relay, no
  push service and no server that receives data from the app.

Data that only Apple processes (on-device or Apple server speech
recognition, APNs delivery, TestFlight crash reports and feedback that the
tester chooses to share) is not developer collection either.

## Answers

- Do you or your third-party partners collect data from this app? **No**
  (App Store label "Data Not Collected").
- Tracking: **No**. `NSPrivacyTracking` is false in every
  `PrivacyInfo.xcprivacy`; no advertising, analytics or crash reporting SDK.

If Pulsatrix ever operates a server for a client, a relay, a push service
or analytics, this answer changes: the data types below then become
"collected, linked to the user, App Functionality, not tracking".

What the app sends to the organization's own server, for reference (not
developer collection under the reading above):

| Apple category | Data type | Sent to the organization's server | Why |
| --- | --- | --- | --- |
| Contact Info | Name, Email Address | Yes | Organization sign-in (OIDC `name`, `email`), account card. |
| User Content | Photos or Videos | Yes | Images the person attaches or shares to a bot. |
| User Content | Audio Data | Only as a fallback | Call audio is uploaded only when the phone cannot recognize speech itself; the server sends it to xAI speech to text under the organization's key and does not store it. |
| User Content | Other User Content | Yes | Messages (typed, dictated or spoken, as text), documents, links, approval answers, encrypted credentials, profile photo. |
| Identifiers | User ID, Device ID | Yes | Account and Perspicax subject; APNs token and paired-device id for notifications and revocation. |
| Usage Data, Diagnostics, Location, Health, Financial, Contacts, Browsing, Search, Sensitive Info, Purchases | | No | Not used. |

Notes per category:

- **Audio Data.** Dictation and normal call recognition stay on the phone
  (`requiresOnDeviceRecognition` whenever the recognizer supports it; iOS 26
  SpeechAnalyzer on device). When on-device recognition is not available,
  Apple's speech servers process the audio: that is Apple, not Pulsatrix.
  The xAI upload (`POST /api/bots/<id>/voice/transcribe`) happens only when
  the phone has no usable recognizer (no recognizer for the language, or
  Speech Recognition permission denied) and voice mode is available.
- **Bot speech.** The reply text sent for text to speech
  (`POST /api/bots/<id>/voice/stream` to xAI, or `/api/tts/speak`) is the
  bot's own text, already part of the conversation. If the person adds an
  ElevenLabs key on the phone, the phone sends the reply text directly to
  ElevenLabs under the person's own ElevenLabs account; Pulsatrix receives
  nothing from that call.
- **Voiceprint ("Only my voice").** On iOS it is a speaking level only, kept
  in UserDefaults on the phone, never sent. Not collected. No biometric
  template is created on iOS.
- **Notifications.** The server stores the APNs token, phone name, app
  version, sound settings (`POST /api/push/devices`). Notification text (up to
  240 characters of the message) transits through Apple.
- **Computer pairing.** Data goes only to the person's own computer.
  The optional hosted relay ("Use your phone anywhere", Cloudflare tunnel)
  is off in shipped builds (no control plane URL is configured,
  `electron/companion-account-service.mjs`), so nothing passes through a
  Pulsatrix relay.
- **Third parties contacted on the person's action:** youtube-nocookie.com
  (embedded player for a YouTube link), Google's favicon service (connected
  app icons; receives the app's web domain), ElevenLabs (only with the
  person's own key). None of them receives an identifier from Sagax and none
  is used for tracking.

## Privacy manifests

`ios/App`, `ios/ShareExtension`, `ios/NotificationService` and
`ios/Widgets` each have a `PrivacyInfo.xcprivacy` with `NSPrivacyTracking`
false, no tracking domains, and required-reason APIs: UserDefaults (CA92.1,
1C8F.1), file timestamps (C617.1), system boot time (extensions).

`NSPrivacyCollectedDataTypes` is empty in all four. Apple's aggregated
privacy report uses the manifests of third-party SDKs; the App Store label
comes from the answers above. Decide whether to mirror the table above in the
app's manifest so both sources agree (recommended, not required for review).

## URLs

- Privacy policy:
  `https://github.com/pulsatrixtechnologies/sagax/blob/main/docs/ios-privacy.md`
  (public repository), also opened by the in-app Settings > Privacy Policy
  row (JC, 2026-10-16).
