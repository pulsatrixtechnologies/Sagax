// Chat links opened from outside the app (a browser, a dashboard, a script):
//
//   openmausbot://thread/<thread-id>?bot=<bot-id>  the exact chat a row's
//                                                  Copy link makes
//   openmausbot://bot/<bot-id>                     the bot's current
//                                                  conversation
//
// Main only recognizes them and hands them to the page, which checks them
// strictly against the chats it has (src/lib/thread-refs.ts) and opens one or
// says it cannot. Opening a link never sends, interrupts or creates anything.
const CHAT_LINK_PREFIXES = ["openmausbot://thread/", "openmausbot://bot/"];
const MAX_LINK_LENGTH = 1024;

export function chatLinkFrom(value) {
  const link = typeof value === "string" ? value.trim() : "";
  if (link.length > MAX_LINK_LENGTH) return null;
  const lower = link.toLowerCase();
  return CHAT_LINK_PREFIXES.some((prefix) => lower.startsWith(prefix)) ? link : null;
}

export function chatLinkFromCommandLine(argv) {
  for (const value of argv) {
    const link = chatLinkFrom(value);
    if (link) return link;
  }
  return null;
}
