// Pin/unpin a bot on the home. Same storage as Electron: `PATCH /api/bots/:id`
// `{ pinned }` (`BotPatch.pinned`, `Session.setPinned`). Electron Sidebar.tsx
// `pinnedBots` includes the Primary Bot; `partitionSidebarBots` leaves chiefs
// in their group unless `openmausbot.universalPins`. iOS matches the visible
// pinned row: a pin lifts the bot (Primary included) into Pinned.
import Foundation

public enum SidebarBotPinning: Sendable {
    /// Trailing swipe distance that reveals Pin / Unpin, like the reference design.
    public static let revealDistance: Double = 72

    /// Electron `bot.pinned`: only `true` is a pin; omitted or false is not.
    public static func isPinned(_ bot: Bot) -> Bool {
        bot.pinned == true
    }

    /// A mostly-horizontal trailing swipe. Vertical scrolling must not trip it.
    public static func swipeRevealsAction(horizontal: Double, vertical: Double) -> Bool {
        horizontal < -40 && abs(horizontal) > abs(vertical) * 1.5
    }

    public static func clampedOffset(_ translation: Double) -> Double {
        min(0, max(translation, -revealDistance))
    }

    /// The Pin / Unpin action exists only while the row is swiped open.
    /// At rest nothing is drawn: rows with clear backgrounds would otherwise
    /// show the button through them (TestFlight 26 home bug).
    public static func actionVisible(offset: Double) -> Bool {
        offset < 0
    }

    /// Width of the revealed action, tracking the swipe.
    public static func actionWidth(offset: Double) -> Double {
        min(revealDistance, max(0, -offset))
    }
}
