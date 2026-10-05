// Settings search (matrix ST11), as the desktop's SettingsModal filters its
// sections: the trimmed, lowercased query matches when the translated label
// or any of the page's keywords contains it; an empty query matches all.
// The keywords are the desktop's (English, as there) for the pages both
// apps have, plus the phone's own pages.
import Foundation

/// A page of the phone's Settings a search can open.
public enum SettingsDestination: String, CaseIterable, Hashable, Sendable {
    // The Settings list, in the desktop's order (NavigationMenus.settings),
    // then the pages one level in.
    case general, organization, appearance, achievements, experimental, plugins, account, botComputer, usage
    case rules, timeZone, language, haptics, quickReplies, walkieVoice, about

    /// The desktop's section keywords for the same page (SettingsModal.tsx
    /// `SECTIONS`), and words for the phone's own pages.
    public var keywords: [String] {
        switch self {
        case .general: return ["general", "notifications", "links", "help", "privacy", "terms", "feedback", "auto-review", "time zone"]
        case .experimental: return ["early", "preview", "skill", "authoring", "browser", "templates", "connected apps"]
        // Pair devices: the computers this phone is paired with
        case .account: return ["profile", "name", "email", "account", "sign out", "delete account", "switch account",
                               "companion", "device", "phone", "desktop", "pair", "pairing", "remote", "server", "connect", "computers"]
        case .usage: return ["tokens", "cost", "billing", "usage", "budget", "spent", "history", "csv", "export"]
        case .plugins: return ["plugins", "tools", "skills", "mcp", "install"]
        case .rules: return ["auto-review", "rules", "approvals", "always allow", "commands"]
        case .timeZone: return ["time zone", "timezone", "clock"]
        case .botComputer: return ["computer", "local vm", "vm", "virtual", "desktop", "ordinateur", "update", "reset", "disk"]
        case .appearance: return ["skin", "theme", "appearance", "font", "threads", "show threads", "hide threads", "sidebar", "hidden", "hide", "show", "dark", "light", "app icon", "icon",
                                     "activity", "tools", "tool calls", "run", "intro", "animation", "density", "compact", "comfortable", "list"]
        case .language: return ["language", "langue", "français", "english", "português"]
        case .haptics: return ["haptics", "vibration", "notifications", "sound", "sounds", "mute", "silent", "chime"]
        case .quickReplies: return ["quick replies", "replies", "shortcuts"]
        case .walkieVoice: return ["walkie", "voice", "speech"]
        case .achievements: return ["achievements", "trophies", "trophy", "points", "gamerscore", "level", "unlock", "succès", "trophées"]
        case .organization: return ["company", "organization", "organisation", "perspicax", "sharing", "full access", "approvals", "routines in my name", "delegation"]
        case .about: return ["about", "version", "build", "license", "à propos"]
        }
    }

    /// Whether this page matches `query` given its translated `label`.
    public func matches(_ query: String, label: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return true }
        if label.lowercased().contains(q) { return true }
        return keywords.contains { $0.lowercased().contains(q) }
    }
}

public enum SettingsSearch {
    /// The pages, among `available`, that match `query`, in their order.
    public static func results(_ query: String, available: [SettingsDestination], label: (SettingsDestination) -> String) -> [SettingsDestination] {
        available.filter { $0.matches(query, label: label($0)) }
    }
}
