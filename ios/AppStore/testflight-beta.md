# External TestFlight beta (first Beta App Review)

Everything needed to send Sagax for iOS to the external group "Bêta Sagax"
for the first time. Verified against the iOS code on branch
`docs/ios-external-beta` (0.5.8, build 37) on 2026-10-16; the first external build is 0.5.9, build 38.

- App Store Connect app: **Sagax**, app id `6818532985`, bundle
  `ca.pulsatrix.sagax`, team `PP546MZVHZ`.
- External group: **Bêta Sagax**, id `779570a0-62a4-4169-85b9-40ad464b0bda`.
- Tool: `asc` 4.11.
- Texts below are plain text (no Markdown) and each is under 4000
  characters. The blocks between `BEGIN` and `END` markers are read by the
  commands at the end of this file; keep the markers when editing.

Nothing in this file has been sent to Apple.

## Beta app information

- Feedback email: `hello@pulsatrix.ca` (public Pulsatrix mailbox, also the
  app's Settings > Send feedback address).
- Marketing URL: `https://github.com/pulsatrixtechnologies/sagax`.
- Privacy policy URL:
  `https://github.com/pulsatrixtechnologies/sagax/blob/main/docs/ios-privacy.md`,
  the same page the app's Settings > Privacy Policy row opens (JC,
  2026-10-16).
- App Privacy label: "Data Not Collected" (each client organization runs
  its own server; see `privacy-answers.md`).
- Demo access: a dedicated reviewer account on a client organization's server,
  created by JC, with one voice-ready bot and no client data. JC types the
  account in App Store Connect; it is never written in this repository.

### Beta app description, fr-CA

<!-- BEGIN beta-description-fr-CA -->
```text
Sagax met vos assistants IA (vos bots) dans votre poche. Les bots travaillent sur votre propre ordinateur, dans l'application Sagax pour bureau, ou sur le serveur Sagax de votre organisation. Sur le téléphone, vous suivez leur travail, répondez à leurs questions et à leurs demandes d'approbation, leur envoyez des messages, des fichiers et des liens, et leur parlez de vive voix.

Pour commencer : connectez-vous à votre organisation avec votre compte Pulsatrix, balayez le code QR de jumelage affiché par Sagax sur votre ordinateur, ou essayez la démo avec des données fictives.

Dans cette bêta :
- Les bots, leurs fils de discussion et les salons, avec les réponses qui s'écrivent en direct
- Les approbations et les questions, aussi depuis le widget de l'écran d'accueil et la Dynamic Island
- Les appels vocaux avec un bot, en français ou en anglais, et vous pouvez l'interrompre
- La dictée dans le champ de message et les notes vocales des bots
- La feuille de partage : envoyez un lien, du texte, une image ou un document à un bot
- Les notifications qui nomment le bot et montrent son visage

Aucun achat, aucune publicité. Vos conversations restent sur votre ordinateur ou sur le serveur de votre organisation.

Merci de nous écrire à hello@pulsatrix.ca ou d'utiliser le bouton de commentaires de TestFlight.
```
<!-- END beta-description-fr-CA -->

### Beta app description, en-CA

<!-- BEGIN beta-description-en-CA -->
```text
Sagax puts your AI assistants (your bots) in your pocket. The bots work on your own computer, in the Sagax desktop app, or on your organization's Sagax server. From the phone you follow their work, answer their questions and approval requests, send them messages, files and links, and talk with them out loud.

To start: sign in to your organization with your Pulsatrix account, scan the pairing QR code shown by Sagax on your computer, or try the demo with made-up data.

In this beta:
- Bots, their threads and rooms, with replies as they are written
- Approvals and questions, also from the Home Screen widget and the Dynamic Island
- Voice calls with a bot, in French or English, and you can interrupt it
- Dictation in the message field and voice notes from bots
- The Share sheet: send a link, text, image or document to a bot
- Notifications that name the bot and show its face

No purchase, no advertising. Your conversations stay on your computer or on your organization's server.

Write to us at hello@pulsatrix.ca or use the TestFlight feedback button.
```
<!-- END beta-description-en-CA -->

## What to Test (next build)

### fr-CA

<!-- BEGIN what-to-test-fr-CA -->
```text
Merci de tester Sagax ! Cette version met l'accent sur les appels vocaux avec un bot.

APPELS VOCAUX
Dans le fil d'un bot, champ de message vide, touchez le bouton à droite du champ pour lancer l'appel. Parlez naturellement, comme au téléphone.
- Compréhension : parlez en français, en anglais, ou mélangez les deux avec des termes TI (par exemple « redémarre le service DNS sur le serveur », « check les logs du firewall », « ouvre un ticket pour Microsoft 365 »). Le bot a-t-il bien compris ? Notez les mots mal reconnus.
- Voix naturelle et continue : la réponse commence-t-elle vite ? Les phrases s'enchaînent-elles sans coupure ni silence bizarre ? La voix lit-elle les chiffres, les sigles et les noms de produits correctement ?
- Interruptions : coupez la parole au bot pendant qu'il parle. Il doit se taire tout de suite et tenir compte de ce que vous venez de dire. Essayez aussi de parler pendant qu'il réfléchit.
- Bruit : testez dans un endroit bruyant, avec une télé ou une autre personne qui parle. Activez « Seulement ma voix » dans le menu de l'appel et comparez.
- Reprise automatique : pendant un appel, passez du Wi-Fi au cellulaire (ou l'inverse), entrez dans un ascenseur, activez puis désactivez le mode avion quelques secondes. L'appel doit reprendre seul, sans perdre la conversation.
- Téléphone verrouillé, écouteurs Bluetooth ou AirPods, un vrai appel entrant pendant l'appel avec le bot : tout doit se comporter comme un appel normal.
- Raccrocher : avec le bouton rouge, ou en disant au bot que vous avez terminé.

À TESTER AUSSI
- Connexion à l'organisation avec votre compte Pulsatrix (clé d'accès ou mot de passe).
- Notifications quand l'application est fermée : messages, approbations, rappels.
- Approbations depuis le fil, le widget « Needs You » et la Dynamic Island.
- Dictée (micro dans le champ de message) en français et en anglais.
- Feuille de partage : envoyer un lien, une photo ou un PDF à un bot depuis Safari ou Photos.
- Widgets de l'écran d'accueil et mode sombre.

Pour signaler un problème : faites une capture d'écran et envoyez-la avec le bouton de commentaires de TestFlight, ou écrivez à hello@pulsatrix.ca. Indiquez l'heure de l'appel et ce que vous avez dit.
```
<!-- END what-to-test-fr-CA -->

### en-CA

<!-- BEGIN what-to-test-en-CA -->
```text
Thank you for testing Sagax! This build focuses on voice calls with a bot.

VOICE CALLS
In a bot's thread, with the message field empty, tap the button at the right of the field to start the call. Speak naturally, as on the phone.
- Understanding: speak French, English, or mix both with IT terms (for example "restart the DNS service on the server", "check les logs du firewall", "open a ticket for Microsoft 365"). Did the bot understand? Note any misheard words.
- Natural, continuous voice: does the answer start quickly? Do sentences flow without gaps or odd silences? Are numbers, acronyms and product names read correctly?
- Interruptions: talk over the bot while it speaks. It should stop at once and take what you just said into account. Also try talking while it is thinking.
- Noise: try a noisy place, with a TV or another person talking. Turn on "Only my voice" in the call menu and compare.
- Automatic recovery: during a call, switch from Wi-Fi to cellular (or back), step into an elevator, or turn Airplane Mode on and off for a few seconds. The call should recover by itself without losing the conversation.
- Locked phone, Bluetooth headphones or AirPods, a real incoming call during the bot call: everything should behave like a normal phone call.
- Hanging up: with the red button, or by telling the bot you are done.

ALSO TEST
- Organization sign-in with your Pulsatrix account (passkey or password).
- Notifications while the app is closed: messages, approvals, nudges.
- Approvals from the thread, the Needs You widget and the Dynamic Island.
- Dictation (microphone in the message field) in French and English.
- Share sheet: send a link, a photo or a PDF to a bot from Safari or Photos.
- Home Screen widgets and dark mode.

To report a problem: take a screenshot and send it with the TestFlight feedback button, or write to hello@pulsatrix.ca. Include the time of the call and what you said.
```
<!-- END what-to-test-en-CA -->

## Notes for Beta App Review (field "Review Notes", under 4000 characters)

Longer version with context: `review-notes.md`.

<!-- BEGIN beta-review-notes -->
```text
Sagax is the phone app of Sagax by Pulsatrix Technologies, a workspace for AI assistants ("bots"). The bots run on the person's own computer (Sagax desktop app) or on their organization's Sagax server. The app follows the bots, answers their questions and approvals, sends them messages and files, and talks with them on voice calls. No in-app purchase, no subscription, no advertising.

The first screen offers three ways in:
1. Try the demo: made-up bots and chats, no account, nothing leaves the phone. Fastest way to see bots, threads, an approval card, routines and a bot's computer screen. Exit with "Exit demo" in the banner.
2. Sign in to an organization: enter the server address, tap "Continue with Pulsatrix", and sign in with Pulsatrix Perspicax (OpenID Connect, passkeys work) in the system authentication sheet. The server returns a short lived pairing link that the app exchanges for a session kept in the Keychain.
3. Connect my computer: scan the QR code shown by the Sagax desktop app (Settings > Phone). Needs a computer running Sagax, no account.

DEMO ACCESS: to be provided by Pulsatrix (account/server)
Server address: <to be provided>
Account: <entered in the App Store Connect demo account fields>
A bot ready for a voice call: <to be provided>

How to test with the demo access:
1. Sign in to an organization with the address and account above.
2. Allow notifications. Send a message to a bot, lock the phone: the answer arrives as a notification naming the bot.
3. Voice call: in a bot's chat, with the message field empty, tap the button at the right of the field. iOS shows the call like a phone call (CallKit). Speak English or French; the bot answers aloud. Talk over it to interrupt. Red button to hang up. The first call asks for microphone and speech recognition access.
4. Dictation: tap the microphone in the message field, speak, tap again; the text is sent only when you tap Send.
5. Share sheet: in Safari or Photos, Share > Sagax, pick a bot, send.
6. Widgets: add the Needs You or Working widget to the Home Screen.

Permissions: camera (pairing QR code only), local network (find the computer on Wi-Fi), microphone (dictation and calls), speech recognition (on the phone whenever iOS supports the language), notifications.

The app does not create accounts; organizations manage them in Pulsatrix Perspicax. Sign out is in Settings.
```
<!-- END beta-review-notes -->

## Beta App Review checklist

| # | Item | Status on 2026-10-16 | How |
| --- | --- | --- | --- |
| 1 | Beta app localizations fr-CA and en-CA: description, feedback email, marketing URL, privacy policy URL | Texts and URLs ready above | `app-localizations create` or `update` (below) |
| 2 | Beta App Review contact: first name, last name, phone, email | **Open**: JC enters them; never commit them | `asc testflight review edit` or the App Store Connect UI |
| 3 | Demo account or access instructions | **Open**: JC creates a reviewer account on a client organization's server (one voice-ready bot, no client data) and types it in App Store Connect. The demo mode covers most screens without an account, but not calls with xAI voices, notifications or the share extension. Recommended: demo account required = true | `asc testflight review edit --demo-account-*` |
| 4 | Review notes | Ready above (`beta-review-notes`) | `asc testflight review edit --notes` |
| 5 | Build uploaded and processed (state VALID), not expired | **Open**: 0.5.9 build 38 | `asc builds list` |
| 6 | Export compliance | `ITSAppUsesNonExemptEncryption` is false in `ios/App/Info.plist` (from `project.yml`); see the analysis below | Nothing to answer in App Store Connect while the key is false |
| 7 | What to Test for the build, fr-CA and en-CA | Ready above | `asc builds test-notes create` |
| 8 | Build added to "Bêta Sagax" | After 1 to 7 | `asc builds add-groups` (without `--submit`) |
| 9 | Submit for Beta App Review | **DO NOT RUN without JC's GO** | `asc testflight review submit` |
| 10 | App Privacy answers and privacy policy published | `privacy-answers.md`, `docs/ios-privacy.md` (merge to main first so the GitHub URL shows them) | App Store Connect UI (App Privacy) |

Other points a reviewer checks on a first external build:

- The app name under the icon is "Sagax", same as App Store Connect.
- Every permission string is present: camera, local network (with Bonjour
  service `_openmausbot._tcp`), microphone, speech recognition.
- No purchase anywhere; links to the desktop download point to GitHub
  releases, a free download, not a purchase.
- The app does not create accounts, so the in-app account deletion rule
  (guideline 5.1.1(v)) does not apply; sign out and unpair are in Settings.

### Export compliance analysis

`ITSAppUsesNonExemptEncryption = false` tells Apple the app uses no
encryption that needs export documentation. What the binary contains:

- HTTPS, WSS and Keychain through iOS (URLSession, URLSessionWebSocketTask,
  WKWebView, Security framework): encryption within Apple's operating
  system.
- HPKE (RFC 9180, P-256, HKDF-SHA256, AES-GCM-256) through Apple CryptoKit
  (`ios/Sources/CompanionCore/PhoneSecret.swift`) to encrypt a credential for
  the paired computer or server, and SHA-256 for file names and keys. Also
  Apple's framework, standard algorithms, nothing proprietary.
- The bundled noVNC viewer (`ios/App/Resources/novnc.min.js`, used to show a
  server sandbox desktop) carries its own JavaScript DES and Diffie-Hellman
  code for VNC password authentication, and calls WebCrypto (the system's)
  for AES and RSA. The app uses it with VNC password authentication over
  WSS.

Conclusion: Apple's exemption for encryption within the operating system
covers HTTPS, Keychain and CryptoKit. The noVNC code is standard encryption
"in addition to" the OS, but its use is authentication only, which is
outside the controlled encryption category, so it still qualifies for an
exemption. `false` is accurate in our reading.

Doubts for JC:

- If App Store Connect ever asks the encryption questions (for example if
  the key is removed), answer: proprietary algorithms No; standard
  algorithms in addition to the OS Yes (noVNC, authentication only);
  qualifies for an exemption Yes. Confirm this reading before answering.
- France: an app limited to exempt encryption needs no French declaration
  in App Store Connect. If the reading above is rejected, France
  availability would need one.

## asc commands

Run from the repository root. Read commands first, to fill the ids. None of
these has been run.

```sh
APP=6818532985
GROUP=779570a0-62a4-4169-85b9-40ad464b0bda
DOC=ios/AppStore/testflight-beta.md
# Text between the BEGIN/END markers of this file, without the fences.
block() { awk -v b="BEGIN $1" -v e="END $1" '$0 ~ b {f=1; next} $0 ~ e {f=0} f' "$DOC" | sed '1d;$d'; }

# 1. Find what exists (reads only)
asc testflight app-localizations list --app "$APP" --output table
asc testflight review view --app "$APP" --output table
asc builds list --app "$APP" --version 0.5.9 --processing-state all --output table

# 2. Beta app localizations. Use create for a missing locale, update with
#    the localization id for an existing one.
asc testflight app-localizations create --app "$APP" --locale fr-CA \
  --description "$(block beta-description-fr-CA)" \
  --feedback-email hello@pulsatrix.ca \
  --marketing-url "https://github.com/pulsatrixtechnologies/sagax" \
  --privacy-policy-url "https://github.com/pulsatrixtechnologies/sagax/blob/main/docs/ios-privacy.md"
asc testflight app-localizations create --app "$APP" --locale en-CA \
  --description "$(block beta-description-en-CA)" \
  --feedback-email hello@pulsatrix.ca \
  --marketing-url "https://github.com/pulsatrixtechnologies/sagax" \
  --privacy-policy-url "https://github.com/pulsatrixtechnologies/sagax/blob/main/docs/ios-privacy.md"
asc testflight app-localizations update --id "<LOCALIZATION_ID>" \
  --description "$(block beta-description-en-CA)" \
  --feedback-email hello@pulsatrix.ca \
  --marketing-url "https://github.com/pulsatrixtechnologies/sagax" \
  --privacy-policy-url "https://github.com/pulsatrixtechnologies/sagax/blob/main/docs/ios-privacy.md"

# 3. Beta App Review details: notes and demo account flag. The contact
#    (--contact-first-name, --contact-last-name, --contact-phone,
#    --contact-email) and the demo account (--demo-account-name,
#    --demo-account-password) are typed by JC at run time or in the
#    App Store Connect UI, never saved in this repository.
asc testflight review edit --id "<REVIEW_DETAIL_ID>" \
  --notes "$(block beta-review-notes)" \
  --demo-account-required true

# 4. What to Test for the processed build
asc builds test-notes create --app "$APP" --build-number "<BUILD_NUMBER>" --version 0.5.9 \
  --locale fr-CA --whats-new "$(block what-to-test-fr-CA)"
asc builds test-notes create --app "$APP" --build-number "<BUILD_NUMBER>" --version 0.5.9 \
  --locale en-CA --whats-new "$(block what-to-test-en-CA)"

# 5. Add the build to the external group (no --submit here)
asc builds add-groups --app "$APP" --build-number "<BUILD_NUMBER>" --version 0.5.9 --group "$GROUP"
```

DO NOT RUN without JC's GO:

```sh
# 6. Submit the build for Beta App Review
asc testflight review submit --build-id "<BUILD_ID>" --confirm
```

After submission: `asc testflight review submissions list --build-id
"<BUILD_ID>"` shows the state. Once approved, testers of "Bêta Sagax" get
the build; later builds of the same version usually skip a full review.
