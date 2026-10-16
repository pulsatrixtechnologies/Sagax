# App Review notes (Sagax for iPhone and iPad)

Paste the "Notes for the reviewer" section below into App Store Connect
(TestFlight > Test Information > Beta App Review, and later App Review).
The rest of this file is for whoever prepares the submission.

Verified against the iOS code on branch `docs/ios-external-beta`
(MARKETING_VERSION 0.5.8, build 37) on 2026-10-16.

## Notes for the reviewer

Sagax is the iPhone and iPad app of Sagax, a workspace for AI assistants
("bots") made by Pulsatrix Technologies. The bots run on the person's own
computer (the Sagax desktop app on macOS or Windows) or on their
organization's Sagax server. The phone app follows those bots, answers their
questions and approvals, sends them work, and talks with them on a voice call.
The app has no in-app purchase, no subscription and no advertising.

The first screen offers three ways in:

1. **Try the demo** (no account, no network). Made-up bots and chats that
   never leave the phone. This is the fastest way to see the interface:
   bots, threads, an approval waiting for an answer, routines and a bot's
   computer screen.
2. **Sign in to an organization**. The person types the address of their
   organization's Sagax server. The app checks that the address is a Sagax
   server, then opens the server's sign-in ("Continue with Pulsatrix") in the
   system authentication sheet (ASWebAuthenticationSession). The organization
   signs people in with Pulsatrix Perspicax (OpenID Connect; passkeys work).
   The server is the OpenID Connect client: no Perspicax token reaches the
   phone. The sheet ends on a short lived `sagax://pair` link that the app
   redeems for a session bound to that person, kept in the iOS Keychain.
3. **Connect my computer**. The person scans the pairing QR code shown by
   the Sagax desktop app (Settings > Phone). The phone then talks directly
   to that computer on the local network (Bonjour) or over Tailscale. No
   Sagax account is needed.

DEMO ACCESS: to be provided by Pulsatrix (account/server)

    Organization server address: <to be provided by Pulsatrix>
    Sign-in account (Pulsatrix Perspicax): <to be provided by Pulsatrix>
    Password or one-time code: <entered in App Store Connect only, never in this file>
    A bot ready for a voice call: <to be provided by Pulsatrix>

### How to test

Demo (no account):

1. Launch Sagax and choose **Try the demo**.
2. Open a bot (for example Atlas) and read its thread; send a message and
   watch the streamed reply.
3. Open Scout's chat and answer the approval card with **Allow** or **Deny**.
4. Open the routines and Forge's computer screen.
5. Tap **Exit demo** in the banner above the chat list. Nothing from the
   demo is stored.

Organization server (needs the DEMO ACCESS above):

1. On the first screen choose **Sign in to an organization**.
2. Enter the server address provided above and tap **Continue with
   Pulsatrix**.
3. Sign in with the provided account in the sheet. The bots and threads of
   that account load.
4. Allow notifications when asked. Send a message to a bot and lock the
   phone: when the bot answers, a notification names the bot and shows its
   avatar.
5. **Voice call**: in a bot's chat, with the message field empty, tap the
   button at the right of the composer (Start voice mode). iOS shows the call
   like a phone call (CallKit). Speak in English or French; the bot answers
   aloud. Talk over the bot to interrupt it. Tap the red button to hang up.
   The first call asks for microphone and speech recognition access.
6. **Dictation**: tap the microphone in the composer, speak, tap again to
   stop; the words appear in the message field and are sent only when the
   person taps Send.
7. **Voice notes**: a bot may answer with a voice note; tap play in the
   message.
8. **Share extension**: in Safari, Photos, Notes or Files, open the Share
   sheet, choose **Sagax**, pick a bot and send a link, text, image or
   document.
9. **Widgets**: add a Sagax widget to the Home Screen (Needs You, Working,
   Updates, Bot); Needs You can answer a bot's question from the Home
   Screen. A Live Activity shows a working bot in the Dynamic
   Island and on the Lock Screen.

Computer pairing (optional, needs a computer with the Sagax desktop app):
install Sagax from https://github.com/pulsatrixtechnologies/sagax/releases,
open Settings > Phone, start pairing, then on the iPhone choose **Connect my
computer** and scan the QR code.

### Permissions the app asks for

- Camera: only to scan the pairing QR code.
- Local network: to find the person's computer on the same Wi-Fi.
- Microphone: while dictating a message or during a voice call with a bot.
- Speech recognition: to turn the person's speech into text. Recognition
  runs on the phone whenever iOS supports it for the language.
- Notifications: messages, approvals and nudges from the person's bots.

### Accounts

The app does not create accounts. Organization accounts are created and
removed by the organization in Pulsatrix Perspicax; computer pairing needs no
account. Sign out (or unpair) is in Settings.
