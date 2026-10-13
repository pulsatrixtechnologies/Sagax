import XCTest
@testable import CompanionCore

/// Electron Settings > Appearance > Sidebar logo (`src/lib/sidebar-logo-preferences.ts`):
/// local only (`sagax-show-sidebar-logo`), hidden unless stored as `"1"`.
final class SidebarLogoPreferenceTests: XCTestCase {
    func testKeyAndDefaultMatchElectron() {
        XCTAssertEqual(SidebarLogoPreference.key, "sagax-show-sidebar-logo")
        XCTAssertFalse(SidebarLogoPreference.defaultEnabled)
        XCTAssertFalse(SidebarLogoPreference.enabled(stored: nil))
        XCTAssertTrue(SidebarLogoPreference.enabled(stored: "1"))
        XCTAssertTrue(SidebarLogoPreference.enabled(stored: "true"))
        XCTAssertFalse(SidebarLogoPreference.enabled(stored: "0"))
    }

    func testIPadHonorsTheStoredPreference() {
        XCTAssertTrue(SidebarLogoPreference.isBrandVisible(enabled: true, idiomIsPad: true, isMac: false))
        XCTAssertFalse(SidebarLogoPreference.isBrandVisible(enabled: false, idiomIsPad: true, isMac: false))
    }

    func testIPhoneKeepsTheBrandVisible() {
        XCTAssertTrue(SidebarLogoPreference.isBrandVisible(enabled: true, idiomIsPad: false, isMac: false))
        XCTAssertTrue(SidebarLogoPreference.isBrandVisible(enabled: false, idiomIsPad: false, isMac: false))
    }

    func testMacKeepsTheDefault() {
        // Mac Catalyst and Designed for iPad on Mac: Electron already has this
        // toggle in the desktop app. The iOS binary on Mac shows no switch and
        // keeps the default, hidden like the desktop's.
        XCTAssertFalse(SidebarLogoPreference.isBrandVisible(enabled: false, idiomIsPad: true, isMac: true))
        XCTAssertFalse(SidebarLogoPreference.isBrandVisible(enabled: false, idiomIsPad: false, isMac: true))
        XCTAssertFalse(SidebarLogoPreference.isBrandVisible(enabled: true, idiomIsPad: true, isMac: true))
    }

    func testTheAppearanceSwitchIsIPadOSOnly() {
        XCTAssertTrue(SidebarLogoPreference.showsSetting(idiomIsPad: true, isMac: false))
        XCTAssertFalse(SidebarLogoPreference.showsSetting(idiomIsPad: false, isMac: false))
        XCTAssertFalse(SidebarLogoPreference.showsSetting(idiomIsPad: true, isMac: true))
        XCTAssertFalse(SidebarLogoPreference.showsSetting(idiomIsPad: false, isMac: true))
    }

    func testAppearanceSearchFindsTheLogoSetting() {
        XCTAssertTrue(DesktopSettingsSection.appearance.matches("logo", label: "Appearance"))
        XCTAssertTrue(SettingsDestination.appearance.matches("logo", label: "Appearance"))
    }
}
