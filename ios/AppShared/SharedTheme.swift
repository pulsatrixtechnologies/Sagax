// The skin, for every target: the app, the widgets and Live Activity, and the
// share extension. The app writes its choice to the app group
// (SharedThemeKeys); the extensions read it here and draw with the same
// tokens, resolving the light or dark skin from their own appearance.
import SwiftUI
import CompanionCore

extension SkinColor {
    var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha) }
    var uiColor: UIColor { UIColor(red: red, green: green, blue: blue, alpha: alpha) }
}

enum SharedTheme {
    /// The skin an extension draws with in `scheme`.
    static func palette(for scheme: ColorScheme) -> SkinPalette {
        SharedThemeKeys.skin(in: SagaxSharedConfiguration.sharedDefaults, deviceDark: scheme == .dark).palette
    }

    /// True when the app pins one skin (not following the phone).
    static var pinnedScheme: ColorScheme? {
        let defaults = SagaxSharedConfiguration.sharedDefaults
        guard defaults?.string(forKey: SharedThemeKeys.mode) == ThemeMode.fixed.rawValue,
              let skin = defaults?.string(forKey: SharedThemeKeys.fixed).flatMap(SkinID.init(rawValue:)) else { return nil }
        return skin.isDark ? .dark : .light
    }
}

/// Reads the app's skin for an extension view: `@Environment` style, from
/// the drawing context's colour scheme.
struct SharedSkinReader<Content: View>: View {
    @Environment(\.colorScheme) private var scheme
    @ViewBuilder let content: (SkinPalette) -> Content

    var body: some View { content(SharedTheme.palette(for: scheme)) }
}
