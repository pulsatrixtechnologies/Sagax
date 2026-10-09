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
