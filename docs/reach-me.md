# Reach me ("Me joindre")

When a bot has a question or an approval that waits on you, it can reach you
outside the app. You choose how, and when, for each bot: Bot panel >
Overview > Reach me. Nobody else chooses for you and no administrator has to
turn it on. Your Primary Bot can change it for you from any conversation
(`sagax_settings`, keys `notifications.reachMe` and
`notifications.reachMeTelegram`).

## Channels

| Channel | What it needs | How you answer |
|---|---|---|
| Phone notifications | The Sagax app paired on your iPhone or Android phone | In the app, or Allow/Deny on the banner (iPhone) |
| Text message | Your Perspicax Voice line, and your own number verified on it | Text back the code, then `oui`/`non` (or your answer) |
| Microsoft Teams | A bot of yours whose engine has a Teams connector (Microsoft 365 on claude.ai, Microsoft Teams on grok.com) | Write the code and your answer in your own Teams chat with yourself, within 40 minutes |
| Telegram | Your own Telegram bot, made with BotFather | Reply to it with the code and your answer |
| WhatsApp | Not available yet | |

Every message carries a short code for that card only, for example
`KM3X`. Answer `KM3X oui` to allow, `KM3X non` to deny, or `KM3X` followed
by your answer to a question. A reply without the right code, from another
number or another chat, answers nothing. A card that needs your security key
can only be denied from outside: open Sagax to allow it. A card of a
confidential conversation never shows its content outside the app.

## Hours

"Any time", or one or more ranges of days and times in your time zone
(22:00 to 07:00 runs past midnight). Outside them nothing leaves the app for
that bot; a card still open when your next range starts is sent then.

## Telegram

1. In Telegram, ask BotFather for a new bot and copy its token.
2. On the bot page, turn Telegram on, paste the token, Connect.
3. Open the link Sagax shows and press Start. That chat is now the only one
   your bot listens to.

The token is sealed on the server and never shown again. Disconnect forgets
it and the chat.

## Teams

Sagax has no Teams app of its own. Each message, and each check for your
answer, is a short run of one of your own bots ("Reach me (Teams)" in
Automations), with your own engine sign-in. That one send to your own chat
asks for no extra approval; anything else the run tries keeps its usual card.
Sagax looks for your answer 2, 6, 15 and 40 minutes after the message.

## Text messages

Texts go from your Perspicax Voice line to your own number, only when the
line lists that number as verified. Each text is billed by the telephony
provider: Sagax never retries one and never answers your reply by text.
The reply reaches Sagax through the Perspicax Voice inbound route
(`POST /api/org/telephony/inbound`), which hands it to `reachMeSmsReply`
(`server/reach-me/inbound.ts`) before the bot's phone triggers.

Developer notes: `AGENTS.md`, "Reach me: one setting per bot to reach the
person outside the app".
