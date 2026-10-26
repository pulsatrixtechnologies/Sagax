// Where a bot's threads and folders live (#143, #210; matrix DC1, DC2):
// Settings > Appearance > "Threads location", per device, never synced
// (`omb-threads-location`, src/lib/thread-preferences.ts). "header" (the
// default) lists nothing under a bot row and reaches the threads through the
// chat header; "sidebar" draws the thread tree under each bot row and no
// threads control in the chat header. Never both. With the threads switch
// off, neither. Rooms are unchanged.
import Foundation

public enum ThreadsLocation: String, CaseIterable, Hashable, Sendable {
    case header
    case sidebar

    /// The device key, the desktop's own name.
    public static let storageKey = "omb-threads-location"
    public static let `default` = ThreadsLocation.header

    /// A stored value, anything unknown read as the default.
    public static func parse(_ raw: String?) -> ThreadsLocation {
        raw.flatMap(ThreadsLocation.init(rawValue:)) ?? .default
    }
}

/// What the switch and the location draw for a bot.
public struct ThreadsPlacement: Hashable, Sendable {
    /// The thread tree (and its thread count) under each bot row.
    public var inSidebar: Bool
    /// The chat header's threads control for a bot.
    public var inHeader: Bool

    public init(inSidebar: Bool, inHeader: Bool) {
        self.inSidebar = inSidebar
        self.inHeader = inHeader
    }

    public init(showThreads: Bool, location: ThreadsLocation) {
        inSidebar = showThreads && location == .sidebar
        inHeader = showThreads && location == .header
    }
}

/// Every place the phone and the iPad draw a thread element. One list, so a
/// new thread control has to say here whether the switch hides it.
public enum ThreadSurface: String, CaseIterable, Hashable, Sendable {
    /// The thread tree and its "› N" count under a bot row (home, iPad
    /// sidebar), and its New thread hover button.
    case sidebarTree
    /// A bot's thread list in the chat header: the name capsule's Threads
    /// and New thread, the iPad header's thread picker.
    case headerPicker
    /// The iPhone chat header's "All threads" button (a bot with two
    /// threads or more), whatever the location.
    case headerButton
    /// A room's thread entries: the name capsule, the "+" menu, Room info.
    case roomThreads
    /// The "+" menu's New thread and Threads for a bot; the iPad compose
    /// picker's New thread.
    case newThread
    /// The thread list sheet itself (TaskManagerView).
    case threadList
    /// "Opened thread" receipts and their Open thread links in the chat.
    case transcriptReceipts
    /// Search's Threads scope and thread results.
    case search
}

/// What Settings > Appearance > Show threads (`omb-show-threads`, synced
/// across the person's devices) and Threads location draw. Off (the default,
/// "Single stream is the default"): no thread element anywhere.
public struct ThreadSurfaces: Hashable, Sendable {
    public var shown: Bool
    public var placement: ThreadsPlacement

    public init(showThreads: Bool, location: ThreadsLocation) {
        shown = showThreads
        placement = ThreadsPlacement(showThreads: showThreads, location: location)
    }

    /// The person's synced record and this device's location.
    public init(prefs: SidebarPrefs, location: ThreadsLocation) {
        self.init(showThreads: prefs.showThreads ?? SidebarPrefs.showThreadsDefault, location: location)
    }

    public func allows(_ surface: ThreadSurface) -> Bool {
        guard shown else { return false }
        switch surface {
        case .sidebarTree: return placement.inSidebar
        case .headerPicker: return placement.inHeader
        case .headerButton, .roomThreads, .newThread, .threadList, .transcriptReceipts, .search: return true
        }
    }

    /// The header's threads button count: nil (no button) below two
    /// threads or with threads off.
    public func headerButtonCount(threadCount: Int) -> Int? {
        allows(.headerButton) && threadCount >= 2 ? threadCount : nil
    }

    /// The name capsule's thread entries for a bot, or for a room.
    public func nameMenuThreads(isBot: Bool) -> Bool {
        allows(isBot ? .headerPicker : .roomThreads)
    }

    /// The thread count a home row shows ("› N"): 0 while the tree is hidden.
    public func rowThreadCount(_ count: Int) -> Int {
        allows(.sidebarTree) ? count : 0
    }
}
