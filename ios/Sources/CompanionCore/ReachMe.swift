// "Reach me" (Me joindre, #1187) on the phone: how THIS bot reaches the
// person outside the app when a question or an approval waits on them, and
// when. The contract is the desktop's (shared/reach-me.ts,
// server/routes/reach-me.ts):
//
//   GET    /api/bots/:id/reach-me           { saved, settings, channels }
//   PUT    /api/bots/:id/reach-me           { channels, smsNumber?, hours }
//   POST   /api/bots/:id/reach-me/telegram  { token } -> the view, { link }
//   DELETE /api/bots/:id/reach-me/telegram  -> the view
//
// Each person chooses for themself, for each bot they can see: no admin.
// The Telegram token is write only (never in an answer). No id on screen:
// the Telegram bot is named by its @username.
import Foundation

/// A channel the setting knows. WhatsApp keeps its place (the screen says it
/// comes later) and is never sent through.
public enum ReachChannelID: String, CaseIterable, Codable, Hashable, Sendable {
    case push, sms, teams, telegram, whatsapp

    /// Wired on every server that has the setting. WhatsApp depends on the
    /// server (#1247): `ReachMeView.offers` reads its answer.
    public var wired: Bool { self != .whatsapp }
}

/// One range: days of the week (0 Sunday to 6 Saturday) and a start and an
/// end time, HH:MM, in the settings' time zone. An end before its start runs
/// past midnight.
public struct ReachHoursRange: Codable, Equatable, Hashable, Sendable {
    public var days: [Int]
    public var start: String
    public var end: String

    public init(days: [Int], start: String, end: String) {
        self.days = days
        self.start = start
        self.end = end
    }
}

/// Any time, or ranges of days and times in a time zone.
public enum ReachHours: Equatable, Hashable, Sendable {
    case always
    case ranges(timeZone: String, ranges: [ReachHoursRange])

    public var isAlways: Bool { if case .always = self { return true } else { return false } }
    public var timeZone: String? { if case let .ranges(zone, _) = self { return zone } else { return nil } }
    public var rangeList: [ReachHoursRange] { if case let .ranges(_, list) = self { return list } else { return [] } }
}

extension ReachHours: Codable {
    private enum Keys: String, CodingKey { case always, timeZone, ranges }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        // As the server reads it: anything but `always: false` is any time.
        guard (try? c.decodeIfPresent(Bool.self, forKey: .always)) == false else { self = .always; return }
        self = .ranges(timeZone: (try? c.decodeIfPresent(String.self, forKey: .timeZone)) ?? "",
                       ranges: (try? c.decodeIfPresent([ReachHoursRange].self, forKey: .ranges)) ?? [])
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .always:
            try c.encode(true, forKey: .always)
        case let .ranges(zone, list):
            try c.encode(false, forKey: .always)
            try c.encode(zone, forKey: .timeZone)
            try c.encode(list, forKey: .ranges)
        }
    }
}

/// The setting for one bot. `channels` keeps the server's words as they
/// are, so a channel this build does not know survives a save.
public struct ReachMeSettings: Codable, Equatable, Hashable, Sendable {
    public var channels: [String]
    /// The person's own number for sms, E.164.
    public var smsNumber: String?
    public var hours: ReachHours

    public init(channels: [String], smsNumber: String? = nil, hours: ReachHours = .always) {
        self.channels = channels
        self.smsNumber = smsNumber
        self.hours = hours
    }

    /// No setting saved: push only, at any hour.
    public static let `default` = ReachMeSettings(channels: [ReachChannelID.push.rawValue])

    public func has(_ channel: ReachChannelID) -> Bool { channels.contains(channel.rawValue) }

    private enum Keys: String, CodingKey { case channels, smsNumber, hours }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        channels = try c.decode([String].self, forKey: .channels)
        smsNumber = try? c.decodeIfPresent(String.self, forKey: .smsNumber)
        hours = (try? c.decodeIfPresent(ReachHours.self, forKey: .hours)) ?? .always
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(channels, forKey: .channels)
        if let smsNumber, !smsNumber.isEmpty { try c.encode(smsNumber, forKey: .smsNumber) }
        try c.encode(hours, forKey: .hours)
    }
}

/// A channel's readiness for this person and bot. `reason` is the server's
/// sentence (a tooltip on the desktop; never an id).
public struct ReachChannelView: Codable, Equatable, Hashable, Sendable {
    public var ready: Bool
    public var reason: String?
    /// Push: the phones (iPhone and Android) that get notifications.
    public var devices: Int?
    /// Telegram: the person's own bot is linked to their chat.
    public var connected: Bool?
    public var username: String?
    /// Telegram: a token is saved and waits for Start in the chat.
    /// WhatsApp: the number is saved and waits for the code from the person's phone.
    public var linking: Bool?
    /// WhatsApp (#1247): the server can receive its replies. Present only on
    /// a server that wires WhatsApp; an older one answers "comes later".
    public var webhookPublic: Bool?
    /// WhatsApp: the business number and its verified name (what the
    /// person connected, never an id), and the wa.me link to send the code.
    public var displayNumber: String?
    public var verifiedName: String?
    public var linkUrl: String?

    public init(ready: Bool = false, reason: String? = nil, devices: Int? = nil, connected: Bool? = nil, username: String? = nil, linking: Bool? = nil,
                webhookPublic: Bool? = nil, displayNumber: String? = nil, verifiedName: String? = nil, linkUrl: String? = nil) {
        self.ready = ready
        self.reason = reason
        self.devices = devices
        self.connected = connected
        self.username = username
        self.linking = linking
        self.webhookPublic = webhookPublic
        self.displayNumber = displayNumber
        self.verifiedName = verifiedName
        self.linkUrl = linkUrl
    }

    private enum Keys: String, CodingKey { case ready, reason, devices, connected, username, linking, webhookPublic, displayNumber, verifiedName, linkUrl }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        ready = (try? c.decodeIfPresent(Bool.self, forKey: .ready)) == true
        reason = try? c.decodeIfPresent(String.self, forKey: .reason)
        devices = try? c.decodeIfPresent(Int.self, forKey: .devices)
        connected = try? c.decodeIfPresent(Bool.self, forKey: .connected)
        username = try? c.decodeIfPresent(String.self, forKey: .username)
        linking = try? c.decodeIfPresent(Bool.self, forKey: .linking)
        webhookPublic = try? c.decodeIfPresent(Bool.self, forKey: .webhookPublic)
        displayNumber = try? c.decodeIfPresent(String.self, forKey: .displayNumber)
        verifiedName = try? c.decodeIfPresent(String.self, forKey: .verifiedName)
        linkUrl = try? c.decodeIfPresent(String.self, forKey: .linkUrl)
    }

    /// WhatsApp's answer comes from a server that wires it: its own fields,
    /// or ready. An older server's "comes later" has none of them.
    var wiresWhatsApp: Bool {
        ready || webhookPublic != nil || connected != nil || linking != nil || displayNumber != nil
    }

    /// The wa.me link that sends the code, only when it is one.
    public var whatsAppLink: URL? {
        guard let linkUrl, let url = URL(string: linkUrl), url.scheme == "https",
              let host = url.host?.lowercased(), host == "wa.me" || host == "api.whatsapp.com"
        else { return nil }
        return url
    }
}

/// The route's answer: the person's choice (or the default) and each
/// channel's readiness. A channel the answer leaves out is not ready.
/// `link` is the t.me address a Telegram connect answers with.
public struct ReachMeView: Decodable, Equatable, Sendable {
    public var saved: Bool
    public var settings: ReachMeSettings
    public var channels: [ReachChannelID: ReachChannelView]
    public var link: String?

    public init(saved: Bool, settings: ReachMeSettings, channels: [ReachChannelID: ReachChannelView] = [:], link: String? = nil) {
        self.saved = saved
        self.settings = settings
        self.channels = Dictionary(uniqueKeysWithValues: ReachChannelID.allCases.map { ($0, channels[$0] ?? ReachChannelView()) })
        self.link = link
    }

    public func channel(_ id: ReachChannelID) -> ReachChannelView { channels[id] ?? ReachChannelView() }

    /// Whether this server sends through the channel: WhatsApp as its
    /// answer says (#1247), the others always.
    public func offers(_ id: ReachChannelID) -> Bool { id.wired || channel(id).wiresWhatsApp }

    private enum Keys: String, CodingKey { case saved, settings, channels, link }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let raw = (try? c.decodeIfPresent([String: ReachChannelView].self, forKey: .channels)) ?? [:]
        var views: [ReachChannelID: ReachChannelView] = [:]
        for (key, value) in raw { if let id = ReachChannelID(rawValue: key) { views[id] = value } }
        self.init(
            saved: (try? c.decodeIfPresent(Bool.self, forKey: .saved)) == true,
            settings: try c.decode(ReachMeSettings.self, forKey: .settings),
            channels: views,
            link: (try? c.decodeIfPresent(String.self, forKey: .link)) ?? nil
        )
    }

    /// The t.me link to press Start in, only when it is one.
    public var telegramLink: URL? {
        guard let link, let url = URL(string: link), url.scheme == "https",
              let host = url.host?.lowercased(), host == "t.me" || host == "telegram.me"
        else { return nil }
        return url
    }
}

public enum ReachMeRules {
    /// Monday first, as the week reads here (the desktop's order).
    public static let days = [1, 2, 3, 4, 5, 6, 0]
    public static let maxRanges = 14
    /// The first range when hours are turned on, and each added one.
    public static let firstRange = ReachHoursRange(days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00")
    public static let addedRange = ReachHoursRange(days: [0, 6], start: "10:00", end: "16:00")

    /// A typed number in E.164: spaces, dashes, dots and parentheses dropped;
    /// a ten digit North American number gets +1 (`normalizePhone`).
    public static func normalizePhone(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let digits = trimmed.filter { !" ().-".contains($0) && !$0.isWhitespace }
        let withPlus: String
        if digits.hasPrefix("+") { withPlus = digits }
        else if digits.count == 10 { withPlus = "+1" + digits }
        else { withPlus = "+" + digits }
        let body = withPlus.dropFirst()
        guard let first = body.first, first != "0", (8...15).contains(body.count),
              body.allSatisfy({ $0.isASCII && $0.isNumber })
        else { return nil }
        return withPlus
    }

    /// "08:30" as minutes of the day, or nil when it is not HH:MM.
    public static func minutes(_ hhmm: String) -> Int? {
        let parts = hhmm.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let h = Int(parts[0]), let m = Int(parts[1]), (0...23).contains(h), (0...59).contains(m)
        else { return nil }
        return h * 60 + m
    }

    /// Minutes of the day as HH:MM.
    public static func hhmm(_ minutes: Int) -> String {
        let value = ((minutes % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", value / 60, value % 60)
    }
}

/// A draft of the form, the way the desktop card keeps one: edits change the
/// draft, Save sends it, Cancel goes back to what the server answered.
public struct ReachMeDraft: Equatable, Sendable {
    public private(set) var view: ReachMeView
    public var settings: ReachMeSettings
    /// The sms number as typed.
    public var phone: String

    public init(_ view: ReachMeView) {
        self.view = view
        settings = view.settings
        phone = view.settings.smsNumber ?? ""
    }

    public var dirty: Bool { settings != view.settings || phone != (view.settings.smsNumber ?? "") }

    /// After a save or a Telegram change: the server's answer, draft dropped.
    public mutating func accept(_ next: ReachMeView) { self = ReachMeDraft(next) }

    /// After a Telegram change: the server's channels, the edits kept.
    public mutating func refreshChannels(_ next: ReachMeView) {
        let edited = settings
        let typed = phone
        let wasDirty = dirty
        view = next
        if wasDirty { settings = edited; phone = typed } else { settings = next.settings; phone = next.settings.smsNumber ?? "" }
    }

    public mutating func cancel() { self = ReachMeDraft(view) }

    public func isOn(_ channel: ReachChannelID) -> Bool { view.offers(channel) && settings.has(channel) }

    /// WhatsApp on a server that does not wire it yet waits: it cannot be turned on.
    public mutating func set(_ channel: ReachChannelID, on: Bool) {
        guard view.offers(channel) else { return }
        settings.channels.removeAll { $0 == channel.rawValue }
        if on { settings.channels.append(channel.rawValue) }
    }

    /// "Only during my hours": on starts Monday to Friday, 08:00 to 18:00 in
    /// this phone's zone; off is any time.
    public mutating func setLimited(_ on: Bool, localZone: String) {
        if on {
            guard settings.hours.isAlways else { return }
            settings.hours = .ranges(timeZone: localZone, ranges: [ReachMeRules.firstRange])
        } else {
            settings.hours = .always
        }
    }

    public mutating func setTimeZone(_ zone: String) {
        guard case let .ranges(_, list) = settings.hours else { return }
        settings.hours = .ranges(timeZone: zone, ranges: list)
    }

    private mutating func editRanges(_ change: (inout [ReachHoursRange]) -> Void) {
        guard case .ranges(let zone, var list) = settings.hours else { return }
        change(&list)
        settings.hours = .ranges(timeZone: zone, ranges: list)
    }

    public mutating func toggle(day: Int, inRange index: Int) {
        editRanges { list in
            guard list.indices.contains(index), (0...6).contains(day) else { return }
            if list[index].days.contains(day) { list[index].days.removeAll { $0 == day } }
            else { list[index].days = (list[index].days + [day]).sorted() }
        }
    }

    public mutating func setStart(_ hhmm: String, inRange index: Int) {
        editRanges { list in if list.indices.contains(index) { list[index].start = hhmm } }
    }

    public mutating func setEnd(_ hhmm: String, inRange index: Int) {
        editRanges { list in if list.indices.contains(index) { list[index].end = hhmm } }
    }

    public var canAddRange: Bool { !settings.hours.isAlways && settings.hours.rangeList.count < ReachMeRules.maxRanges }
    public var canRemoveRange: Bool { settings.hours.rangeList.count > 1 }

    public mutating func addRange() {
        guard canAddRange else { return }
        editRanges { $0.append(ReachMeRules.addedRange) }
    }

    public mutating func removeRange(at index: Int) {
        guard canRemoveRange else { return }
        editRanges { list in if list.indices.contains(index) { list.remove(at: index) } }
    }

    public enum Problem: Error, Equatable, Sendable {
        /// The typed number is not a phone number in international form.
        case invalidNumber
        /// Text messages need the person's own number.
        case numberNeeded
    }

    /// What Save sends, or why it cannot. The server checks the rest (time
    /// zone, ranges) and answers with its own sentence.
    public func payload() -> Result<ReachMeSettings, Problem> {
        let typed = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        var next = settings
        if typed.isEmpty {
            next.smsNumber = nil
        } else {
            guard let normalized = ReachMeRules.normalizePhone(typed) else { return .failure(.invalidNumber) }
            next.smsNumber = normalized
        }
        if next.has(.sms), next.smsNumber == nil { return .failure(.numberNeeded) }
        return .success(next)
    }
}
