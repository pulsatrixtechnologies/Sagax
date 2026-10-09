// Release notes in the app (#184; matrix DC21): the account menu's Release
// notes opens the notes of every bundled version (docs/releases/*.md, copied
// into the app), newest first with the running one marked, in the
// person's language (src/lib/release-notes.ts `releaseNotesSection`), and
// "Changes since my last version".
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
}
