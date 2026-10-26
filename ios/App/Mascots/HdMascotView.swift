// HD mascots (src/components/hd-mascots, Settings > Appearance > Mascots >
// HD mascots, `sagax.hdMascots.v1`): a character that ships painted art
// shows its still for the state instead of the vector look. Shiba only for
// now; on unless the person turned it off. The art is painted, so skins and
// bot colours leave it. The desktop's looping clips draw as their still
// here. A bundle without the art (the widgets) keeps the vector look.
import CompanionCore
import SwiftUI
import UIKit

enum HdMascotRuntime {
    /// The person's choice, set by SidebarPrefsModel and published to the
    /// views by ThemeRoot (`\.hdMascotsEnabled`).
    static var enabled: Bool {
        get { UserDefaults.standard.object(forKey: storageKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: storageKey) }
    }

    private static let storageKey = "companion.prefs.hdMascots"
    private static var cache: [String: UIImage] = [:]

    /// The still for a character and state, or nil to draw the vector look.
    static func image(character: String, state: String, enabled: Bool) -> UIImage? {
        guard enabled, HdMascots.characters.contains(character) else { return nil }
        let name = HdMascots.resource(character: character, still: HdMascots.still(forState: state))
        if let hit = cache[name] { return hit }
        guard let url = Bundle.main.url(forResource: name, withExtension: "webp"),
              let image = UIImage(contentsOfFile: url.path) else { return nil }
        cache[name] = image
        return image
    }
}

/// A painted still in the mascot's square.
struct HdMascotStill: View {
    let image: UIImage
    let size: CGFloat

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

private struct HdMascotsEnabledKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// Settings > Appearance > Mascots > HD mascots (on by default).
    var hdMascotsEnabled: Bool {
        get { self[HdMascotsEnabledKey.self] }
        set { self[HdMascotsEnabledKey.self] = newValue }
    }
}
