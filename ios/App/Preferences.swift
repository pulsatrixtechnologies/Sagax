// Where the chat's preferences are stored.
//
// `@AppStorage` rather than an observable object on purpose: the settings
// screen writes these and the chat reads them, and AppStorage already keeps
// both in step through UserDefaults. One place for the key strings is the
// only thing a shared type is needed for.
import Foundation
import SwiftUI
import UIKit
import CompanionCore

enum PrefKey {
    static let activityDetail = "companion.prefs.activityDetail"
    static let quickReplies = "companion.prefs.quickReplies"
    static let language = "companion.prefs.language"
    /// Per device, like the desktop's sidebar density: a phone and a laptop
    /// have different room for a list.
    static let rosterDensity = "companion.prefs.rosterDensity"
    /// Personalization: the large Updates button on the standard home.
    static let updatesButton = "companion.prefs.updatesButton"
    /// When on, the home's search and + sit at the top instead of the bottom.
    static let rosterChromeAtTop = "companion.prefs.rosterChromeAtTop"
    /// The iPad desktop sidebar's density (comfortable, compact, icons),
    /// per device as on the desktop (`openmausbot.sidebarDensity`).
    static let desktopSidebarDensity = "companion.prefs.desktopSidebarDensity"
    /// The density the rail returns to when it expands again.
    static let desktopSidebarExpandedDensity = "companion.prefs.desktopSidebarExpandedDensity"
}

/// Device flags for the Electron sidebar-logo preference (`sagax-show-sidebar-logo`).
enum SidebarLogoRuntime {
    static var isMac: Bool {
        #if targetEnvironment(macCatalyst)
        true
        #else
        ProcessInfo.processInfo.isiOSAppOnMac
        #endif
    }

    static var idiomIsPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    static var showsSetting: Bool {
        SidebarLogoPreference.showsSetting(idiomIsPad: idiomIsPad, isMac: isMac)
    }

    static func isBrandVisible(_ enabled: Bool) -> Bool {
        SidebarLogoPreference.isBrandVisible(enabled: enabled, idiomIsPad: idiomIsPad, isMac: isMac)
    }
}

