# Sagax for iPhone and iPad: privacy

Last updated: 2026-10-16. Applies to Sagax for iOS and iPadOS 0.5.8 and later.

Sagax for iPhone and iPad ("the app") is published by Pulsatrix Technologies
Inc. ("Pulsatrix"). It is the phone app of Sagax: it shows and controls AI
assistants ("bots") that run somewhere the person chose:

- on **their own computer**, in the Sagax desktop app, paired by scanning a
  QR code; or
- on **their organization's Sagax server**, after signing in with the
  organization's Pulsatrix account (Pulsatrix Perspicax).

The app also has a **demo** with made-up data that never leaves the phone.

The app contains no advertising, no analytics SDK and no third-party
tracking SDK. It does not track people across other companies' apps or
websites, and Pulsatrix does not sell personal information.

## Who handles your data

- **Your computer** (computer pairing): the Sagax desktop app on your own
  computer stores your bots, conversations, approvals, files and settings.
  Pulsatrix does not receive a copy.
- **Your organization's server** (organization sign-in): the organization
  that runs the server, or the provider that runs it for them, stores your
  conversations, files, settings and account. That organization decides how
  long they are kept. Ask its administrator for access or deletion. When
  Pulsatrix operates a server for an organization, Pulsatrix processes that
  data on the organization's behalf and under its instructions.
- **The phone** keeps only what is listed below.

## What the phone keeps

- The address of each paired computer or organization server, and which one
  is active (iOS preferences and the private Sagax App Group).
- The session credential for each of them, in the iOS Keychain (shared only
  with the Sagax Share, widget and notification extensions through a private
  Keychain group).
- The last organization server address typed, so it is prefilled next time.
- Your profile photo for each connection, as served by that connection, in
  the app's cache.
- A small summary for the Home Screen widgets and Live Activities (bot names,
  status, the question a bot is asking you), in the private App Group.
- Settings such as theme, language, notification sounds and voice call
  preferences.
- If you turn on **Only my voice** for calls: a record of your usual speaking
  level, kept in the app's preferences on this phone. It is not a voice
  recording and not a biometric template, it is never sent anywhere, and
  **Forget my voice** deletes it.
- If you add your own **ElevenLabs** key under Settings > Call voice: that
  key, in this phone's Keychain only. It is never sent to your computer or
  organization server.

Removing a connection (or signing out) deletes its address and credential
from the phone and ends the session on that server. Deleting the app removes
everything the app keeps on the phone, except Keychain items, which iOS may
keep until the device is erased.

## Connecting

- **Computer pairing.** The camera is used only to scan the pairing QR code;
  no image is kept. On the same Wi-Fi the app finds your computer with
  Bonjour (local network permission) and talks to it directly. Away from
  home it can reach the computer through Tailscale, a separate service with
  its own privacy terms. Pulsatrix does not operate a relay for computer
  pairing in this version.
- **Organization sign-in.** The app opens your organization server's sign-in
  page in the iOS authentication sheet. You sign in with Pulsatrix Perspicax
  (OpenID Connect; passkeys and Safari's saved sign-ins work). The server, not
  the phone, receives your identity from Perspicax: an identifier, your email
  address, your name, your username and, when set, your profile photo. The
  phone receives only a short lived pairing link, exchanges it for a session
  bound to you, and never receives a Perspicax token.
- At pairing the app sends the phone's name as iOS reports it (on current
  iOS, a generic name such as "iPhone"), so you can recognize and revoke the
  device later.

## Messages, files and sharing

- What you type, the files and photos you pick, and what you send from
  another app's **Share** sheet go to the bot or room you choose, on your
  computer or your organization server. The app does not keep a copy after
  sending; the Share extension deletes its temporary copy after sending or
  cancelling.
- Images are limited to 10 MiB each and documents to 25 MiB, at most four
  items and 50 MiB per message.
- Opening a file a bot sent downloads it from your computer or server and
  keeps a temporary preview only while it is open.
- **Voice notes** a bot sends are audio files stored with the conversation on
  your computer or server; the app plays them and does not record voice
  notes itself.
- When a bot asks for a password or API key, the value you enter is
  encrypted on the phone (HPKE with Apple CryptoKit) for the paired computer
  or server and sent only over an encrypted connection. The app clears the
  field right away and never stores the value.

## Microphone, speech recognition and voice calls

The microphone is used only while you dictate a message or are on a voice
call with a bot, and the app shows when it is listening.

- **Dictation** (the microphone in the message field) uses Apple's speech
  recognition. When iOS supports on-device recognition for your language,
  the app requires it, so the audio stays on the phone. Otherwise Apple
  processes the audio under Apple's own privacy terms. The words appear in
  the message field and are sent only when you tap Send.
- **Voice calls** with a bot keep the microphone open for the whole call,
  like a phone call. iOS shows the call through CallKit; Sagax keeps bot
  calls out of the Phone app's Recents.
  - Your speech is recognized on the phone with Apple's speech recognition
    (on device whenever iOS allows; on iOS 26 and later with Apple's on-device
    transcriber once the language model is installed).
  - Only when the phone cannot recognize speech itself (no recognizer for
    your language, or speech recognition access turned off for Sagax) and
    voice mode is available does the app upload each spoken turn (a short
    audio clip) to your computer or organization server, which sends it to
    xAI speech to text and returns the words. The clip is not stored.
  - The recognized **text** of each turn goes to the bot as an ordinary
    message and is stored in the conversation, marked as said on a call.
  - The bot's reply is read aloud. Depending on what your computer or server
    has set up, the reply **text** is turned into speech by: xAI text to
    speech through your computer or organization server (voice mode); the
    voice provider configured on your computer; ElevenLabs, called directly
    from the phone with your own key if you added one; or the phone's built-in
    voice, which stays on the phone.
  - The xAI key is never on the phone. On an organization server the key is
    your own xAI key registered in Perspicax if you have one, otherwise the
    organization's key; on your own computer it is the key you configured
    there. xAI receives the audio or text it converts, under the terms of that
    key's account. xAI is used only to convert speech and text, never to
    write the bot's answers.
  - The server records how much speech was converted (characters or audio
    length) for usage reporting, not the audio itself.

## Notifications

When you allow notifications, the app gives the active computer or server
the phone's Apple Push Notification service (APNs) token, the phone's name,
the app version and your notification sound settings
(`POST /api/push/devices`). A server set up to send pushes (organization
servers are) then sends notifications through Apple when the app is closed: a message (its text, cut to 240 characters), a nudge, an approval, a
failed routine or an achievement, with the sender's name and a link to their
avatar. Notification content travels through Apple like any messaging app.

The Sagax notification extension runs on the phone when such a notification
arrives. It reads only that notification, downloads the sender's avatar from
the same server (other addresses are ignored), and shows the bot or person as
the sender. Signing out removes the token from the server. While a voice
call is live, notifications for that conversation stay silent.

## Widgets and Live Activities

Widgets and Live Activities show the summary listed above. The **Needs You**
widget can answer a bot's question from the Home Screen: the widget sends
that one answer to your computer or server using the stored session.

## Other services the app may contact

Only in response to what you open:

- A YouTube link in a conversation plays in an embedded player from
  youtube-nocookie.com.
- Connected app icons may be loaded from the address your server gives or
  from Google's favicon service (which then receives that app's web domain).
- Web links open in Safari or an in-app Safari view.

## Diagnostics and feedback

The app has no crash reporting or analytics SDK and sends no diagnostics to
Pulsatrix. If you share crash data or TestFlight feedback with developers in
iOS settings, Apple provides it to Pulsatrix under Apple's terms. **Send
feedback** in Settings opens an email to hello@pulsatrix.ca with the app
version and iOS version filled in; you see and send it yourself.

## Children

The app is a work tool and is not directed to children under 13.

## Your choices and rights

- Turn off camera, microphone, speech recognition, local network or
  notifications at any time in iOS Settings > Sagax.
- Remove a connection or sign out in Sagax Settings.
- For conversations and account data held by your organization, contact its
  administrator. For data on your own computer, use the Sagax desktop app.
- For any privacy question or request to Pulsatrix, including requests under
  Quebec's privacy law (Law 25), write to hello@pulsatrix.ca. Never include a
  password, code or token in the message.
