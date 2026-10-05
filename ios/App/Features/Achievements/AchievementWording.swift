// Words, icons and colours of the achievements, as the desktop draws them:
// the reward labels (`rewardLabel` in src/lib/achievements.ts), the rarity
// colours of achievements.css, and the catalog's lucide icons
// (src/components/achievements/icons.ts) as SF Symbols.
import CompanionCore
import SwiftUI
import UIKit

enum AchievementWording {
    static func rewardLabel(_ reward: AchievementReward, language: String?) -> String {
        switch reward {
        case let .character(_, name):
            return String(localized: "Character unlocked: \(name.resolved(language))")
        case let .skin(_, _, name, characterName):
            return String(localized: "Skin unlocked: \(name.resolved(language)) (\(characterName.resolved(language)))")
        case .appIcon:
            return String(localized: "App icon unlocked")
        case let .title(_, name):
            return String(localized: "Title unlocked: \(name.resolved(language))")
        }
    }

    static func rarityLabel(_ rarity: AchievementRarity) -> LocalizedStringKey {
        switch rarity {
        case .common: "Common"
        case .rare: "Rare"
        case .epic: "Epic"
        case .legendary: "Legendary"
        }
    }

    /// common #9aa3ad, rare #60a5fa, epic #c084fc, legendary #fbbf24.
    static func color(_ rarity: AchievementRarity) -> Color {
        switch rarity {
        case .common: Color(hex: 0x9AA3AD)
        case .rare: Color(hex: 0x60A5FA)
        case .epic: Color(hex: 0xC084FC)
        case .legendary: Color(hex: 0xFBBF24)
        }
    }

    static func categoryLabel(_ category: AchievementCategory?) -> LocalizedStringKey {
        switch category {
        case nil: "All"
        case .onboarding?: "Getting started"
        case .productivity?: "Productivity"
        case .power?: "Power user"
        case .voice?: "Voice"
        case .collaboration?: "Together"
        case .streaks?: "Streaks"
        case .mastery?: "Mastery"
        case .secrets?: "Secrets"
        }
    }

    static func filterLabel(_ filter: AchievementFilter) -> LocalizedStringKey {
        switch filter {
        case .all: "All"
        case .unlocked: "Unlocked"
        case .locked: "Locked"
        }
    }

    /// The lucide name of a catalog icon as an SF Symbol; a trophy otherwise.
    static func symbol(_ lucide: String) -> String {
        guard let name = symbols[lucide], UIImage(systemName: name) != nil else { return "trophy.fill" }
        return name
    }

    private static let symbols: [String: String] = [
        "AppWindow": "macwindow", "Award": "rosette", "Bot": "cpu", "CalendarCheck": "calendar.badge.checkmark",
        "CalendarClock": "calendar.badge.clock", "CalendarDays": "calendar", "Cog": "gearshape.fill", "Crown": "crown.fill",
        "Feather": "leaf.fill", "FileArchive": "doc.zipper", "Flame": "flame.fill", "FolderOpen": "folder.fill",
        "Gamepad2": "gamecontroller.fill", "Gem": "diamond.fill", "Hand": "hand.raised.fill", "Heart": "heart.fill",
        "HeartHandshake": "hands.sparkles.fill", "Keyboard": "keyboard", "Layers": "square.3.layers.3d", "Medal": "medal.fill",
        "MessageCircle": "message.fill", "MessageSquareMore": "text.bubble.fill", "MessagesSquare": "bubble.left.and.bubble.right.fill",
        "Monitor": "display", "Moon": "moon.fill", "MousePointerClick": "cursorarrow.click", "Navigation": "location.north.fill",
        "Network": "point.3.connected.trianglepath.dotted", "Palette": "paintpalette.fill", "Paperclip": "paperclip",
        "Phone": "phone.fill", "PhoneCall": "phone.arrow.up.right.fill", "PhoneForwarded": "phone.arrow.right.fill",
        "Repeat": "repeat", "Rocket": "paperplane.fill", "Scale": "scalemass.fill", "Search": "magnifyingglass",
        "Send": "paperplane", "Share2": "square.and.arrow.up", "ShieldCheck": "checkmark.shield.fill", "Shirt": "tshirt.fill",
        "Slash": "slash.circle", "Split": "arrow.triangle.branch", "SquareTerminal": "terminal.fill", "Timer": "timer",
        "Trophy": "trophy.fill", "Users": "person.3.fill", "UsersRound": "person.2.fill", "Zap": "bolt.fill",
    ]
}
