// Settings > Appearance > "Color 1:1 messages with the bot color"
// (`sagax.botBubble.v1`). Off by default: bubbles stay the skin's, black
// on Black. On, a 1:1 bot chat paints the assistant bubble and its cards
// with that bot's colour. The person's own bubbles stay. A room never
// sets an open bot colour, so it is unchanged.
import Foundation

public enum BotBubble {
    /// Synced with the person (`USER_PREFERENCE_KEYS`). "1" is on.
    public static let key = "sagax.botBubble.v1"

    public struct Paint: Equatable, Sendable {
        public var fill: SkinColor
        public var ink: SkinColor
    }

    /// Nil keeps the skin. `panel` is the surface the fill has to read on.
    public static func paint(enabled: Bool, botColor: String?, panel: SkinColor) -> Paint? {
        guard enabled, let name = botColor?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty,
              let hex = MausColors.hex(for: name), let color = SkinColor(css: hex) else { return nil }
        let fill = BotAccent.holdContrast(color, on: panel, ratio: 3)
        return Paint(fill: fill, ink: BotAccent.ink(on: fill))
    }
}
