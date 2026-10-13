// Settings > Appearance > Sidebar logo (`src/lib/sidebar-logo-preferences.ts`).
// Same key as Electron (`sagax-show-sidebar-logo`), local only: UserDefaults
// here, localStorage on desktop. Not synced through the server. Default off:
// shown only once turned on (the owner's reference window of 2026-10-12).
import Foundation

public enum SidebarLogoPreference: Sendable {
    /// Electron `SIDEBAR_LOGO_KEY`.
    public static let key = "sagax-show-sidebar-logo"

    /// Electron default: hidden unless explicitly turned on.
    public static let defaultEnabled = false

    /// Electron `showSidebarLogo()`: shown only when stored as `"1"`
    /// (`"true"` is how UserDefaults may spell a Bool).
    public static func enabled(stored: String?) -> Bool {
        stored == "1" || stored == "true"
    }

    /// The mark and "Sagax" in the sidebar head. iPadOS honors the stored
    /// preference. Mac (Catalyst / Designed for iPad on Mac) has no switch
    /// (Electron owns it on the Mac desktop app), so it keeps the default,
    /// hidden like the desktop's; the phone roster has no brand row to hide.
    public static func isBrandVisible(enabled: Bool, idiomIsPad: Bool, isMac: Bool) -> Bool {
        if isMac { return defaultEnabled }
        if idiomIsPad { return enabled }
        return true
    }

    /// The Appearance switch itself: iPadOS only, not Mac.
    public static func showsSetting(idiomIsPad: Bool, isMac: Bool) -> Bool {
        idiomIsPad && !isMac
    }
}
