// Release notes in the app (#184; matrix DC21): the account menu's Release
// notes opens the notes of every bundled version (docs/releases/*.md, copied
// into the app), newest first with the running one marked, in the
// person's language (src/lib/release-notes.ts `releaseNotesSection`), and
// "Changes since my last version". The large layout also opens "What's new"
// once after an update, as the desktop's ReleaseNotesPrompt does
// (`whatsNew`, the record of `seenReleaseRecord`).
import Foundation

public enum ReleaseNotes {
    /// `releaseNotesSection`: the French part (before "## English") for a
    /// French UI, the English part otherwise; the whole file without one.
    public static func section(_ markdown: String, language: String) -> String {
        let text = markdown.replacingOccurrences(of: "\r\n", with: "\n")
        guard let range = text.range(of: #"(?m)^##\s+English\s*$"#, options: .regularExpression) else {
            return text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let french = text[..<range.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines)
        let english = text[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        let lang = language.trimmingCharacters(in: .whitespaces).lowercased()
        if lang == "fr" || lang.hasPrefix("fr-") || lang.hasPrefix("fr_") { return french.isEmpty ? english : french }
        return english.isEmpty ? french : english
    }

    /// Numeric version order ("0.4.10" after "0.4.9").
    public static func compare(_ a: String, _ b: String) -> ComparisonResult {
        let left = a.split(separator: ".").map { Int($0) ?? 0 }
        let right = b.split(separator: ".").map { Int($0) ?? 0 }
        for index in 0..<max(left.count, right.count) {
            let x = index < left.count ? left[index] : 0
            let y = index < right.count ? right[index] : 0
            if x != y { return x < y ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }

    /// `bundledVersions`: newest first.
    public static func versions(_ catalog: [String: String]) -> [String] {
        catalog.keys.sorted { compare($0, $1) == .orderedDescending }
    }

    /// `bundledNotesSince`: after `previous` up to `current`, newest first.
    public static func since(_ previous: String, current: String, catalog: [String: String]) -> [String] {
        versions(catalog).filter { compare($0, previous) == .orderedDescending && compare($0, current) != .orderedDescending }
    }

    /// The catalog from a folder of `<version>.md` files.
    public static func catalog(in folder: URL) -> [String: String] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        var out: [String: String] = [:]
        for file in files where file.pathExtension == "md" {
            let version = file.deletingPathExtension().lastPathComponent
            guard version.range(of: #"^\d+(\.\d+)*$"#, options: .regularExpression) != nil,
                  let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            out[version] = text
        }
        return out
    }

    /// `RELEASE_VERSION`: 1.2.3, optionally with a prerelease tag.
    public static func isReleaseVersion(_ version: String) -> Bool {
        version.range(of: #"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$"#, options: .regularExpression) != nil
    }

    /// `whatsNewDecision`: whether to open What's new on this launch, and
    /// the version to record as seen. A fresh install (nothing seen, never
    /// used) records the version and stays quiet; the same version stays
    /// quiet; a newer one, or the first launch of this feature on an app
    /// that was already used, shows once.
    public static func whatsNew(version: String, dev: Bool, seen: String?, previouslyInstalled: Bool) -> (show: Bool, seen: String?) {
        if dev || !isReleaseVersion(version) { return (false, nil) }
        if seen == version { return (false, seen) }
        if seen == nil && !previouslyInstalled { return (false, version) }
        return (true, version)
    }
}

/// What the app remembers of the notes it showed (`seenReleaseRecord`): the
/// version last seen and the one before it, for "Changes since my last
/// version". Stored as the desktop's JSON; a plain version string (the
/// phone's first record) still reads.
public struct ReleaseNotesSeen: Equatable, Sendable {
    public var version: String
    public var previous: String?

    public init(version: String, previous: String? = nil) {
        self.version = version
        self.previous = previous == version ? nil : previous
    }

    /// `readSeenRelease` and `readPreviousRelease`.
    public static func read(_ raw: String?) -> ReleaseNotesSeen? {
        guard let raw, !raw.isEmpty else { return nil }
        if let data = raw.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            guard let version = object["version"] as? String, !version.isEmpty else { return nil }
            let previous = (object["previous"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return ReleaseNotesSeen(version: version, previous: previous)
        }
        let plain = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return plain.range(of: #"^\d+(\.\d+)*"#, options: .regularExpression) != nil ? ReleaseNotesSeen(version: plain) : nil
    }

    /// `seenReleaseRecord`: `{"version": ...}` with `previous` when it differs.
    public var json: String {
        var object: [String: String] = ["version": version]
        if let previous, previous != version { object["previous"] = previous }
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    /// The record after `current` was seen: the version seen before moves to `previous`.
    public func seeing(_ current: String) -> ReleaseNotesSeen {
        version == current ? self : ReleaseNotesSeen(version: current, previous: version)
    }

    /// The version "Changes since my last version" starts after, running `current`.
    public func lastVersion(before current: String) -> String? {
        version == current ? previous : version
    }
}

