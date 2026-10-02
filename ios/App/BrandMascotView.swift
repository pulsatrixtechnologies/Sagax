// The app's own mascot wherever the brand shows (onboarding pages, the
// Settings header): the Sagax owl until a computer, an organization or the
// demo is open, then the person's Primary Bot in its own character, colour
// and skin (CompanionCore/BrandMascot.swift). It follows the fleet live, so
// a new Primary Bot or a new look shows at once, and the last look is kept
// per connection for an offline launch. The app icon stays the owl.
import CompanionCore
import SwiftUI

enum BrandMascotCache {
    private static func key(_ connectionID: String) -> String { "sagax.brand.primary.\(connectionID)" }

    static func load(_ connectionID: String?) -> Bot? {
        guard let connectionID, let data = UserDefaults.standard.data(forKey: key(connectionID)) else { return nil }
        return try? JSONDecoder().decode(Bot.self, from: data)
    }

    static func save(_ mascot: BrandMascot, connectionID: String?) {
        guard let connectionID else { return }
        switch mascot {
        case let .primary(bot):
            if let data = try? JSONEncoder().encode(bot) { UserDefaults.standard.set(data, forKey: key(connectionID)) }
        case .sagaxOwl:
            UserDefaults.standard.removeObject(forKey: key(connectionID))
        }
    }

    static func forget(_ connectionID: String) {
        UserDefaults.standard.removeObject(forKey: key(connectionID))
    }
}

extension Session {
    /// The mascot that stands for the app right now.
    var brandMascot: BrandMascot {
        BrandMascot.resolve(
            connected: connection != nil,
            bots: state.bots,
            cached: isDemo ? nil : BrandMascotCache.load(connection?.id)
        )
    }
}

struct BrandMascotView: View {
    @EnvironmentObject private var session: Session
    /// The owl's colour when no Primary Bot stands in.
    var owlColor = "blue"
    var size: CGFloat
    var animated = true

    var body: some View {
        Group {
            switch session.brandMascot {
            case .sagaxOwl:
                OwlMascotView(color: owlColor, size: size, state: .idle, animated: animated)
                    .accessibilityIdentifier("brand-mascot.owl")
            case let .primary(bot):
                // Animated lightly; MascotCharacterView keeps Reduce Motion.
                MascotCharacterView(bot: bot, size: size, state: .idle, animated: animated)
                    .accessibilityIdentifier("brand-mascot.\(bot.id)")
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
