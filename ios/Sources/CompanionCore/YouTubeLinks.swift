import Foundation

/// YouTube URLs in bot markdown (parity with `shared/video-widget.ts`).
public enum YouTubeLinks {
    public static func videoId(from urlString: String) -> String? {
        guard let url = URL(string: urlString.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host?.lowercased().replacingOccurrences(of: "www.", with: "")
        else { return nil }
        let path = url.path
        if host == "youtu.be" {
            let id = String(path.dropFirst()).split(separator: "/").first.map(String.init) ?? ""
            return id.count == 11 && id.range(of: #"^[\w-]{11}$"#, options: .regularExpression) != nil ? id : nil
        }
        guard host == "youtube.com" || host == "m.youtube.com" || host == "music.youtube.com" || host == "youtube-nocookie.com"
        else { return nil }
        if path == "/watch" {
            let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "v" })?.value ?? ""
            return id.count == 11 ? id : nil
        }
        if path.hasPrefix("/embed/") {
            let id = String(path.dropFirst(7)).split(separator: "/").first.map(String.init) ?? ""
            return id.count == 11 ? id : nil
        }
        if path.hasPrefix("/shorts/") {
            let id = String(path.dropFirst(8)).split(separator: "/").first.map(String.init) ?? ""
            return id.count == 11 ? id : nil
        }
        return nil
    }

    public static func ids(in text: String) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        func add(_ id: String?) {
            guard let id, !seen.contains(id) else { return }
            seen.insert(id)
            out.append(id)
        }
        let urlPattern = #"https?://[^\s<>)\]]+"#
        if let regex = try? NSRegularExpression(pattern: urlPattern, options: .caseInsensitive) {
            let range = NSRange(text.startIndex..., in: text)
            for match in regex.matches(in: text, range: range) {
                guard let r = Range(match.range, in: text) else { continue }
                add(videoId(from: String(text[r])))
            }
        }
        let mdPattern = #"\[[^\]]*]\((https?://[^)]+)\)"#
        if let regex = try? NSRegularExpression(pattern: mdPattern, options: .caseInsensitive) {
            let range = NSRange(text.startIndex..., in: text)
            for match in regex.matches(in: text, range: range) {
                guard match.numberOfRanges > 1, let r = Range(match.range(at: 1), in: text) else { continue }
                add(videoId(from: String(text[r])))
            }
        }
        return out
    }

    /// True when the paragraph is only a YouTube URL or markdown link to one.
    /// The external label stays `videoId`; the internal name must not shadow `videoId(from:)`.
    public static func isStandaloneParagraph(_ text: String, videoId expectedId: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if Self.videoId(from: trimmed) == expectedId { return true }
        let md = #"^\[[^\]]*]\((https?://[^)]+)\)\s*$"#
        guard let regex = try? NSRegularExpression(pattern: md, options: .caseInsensitive),
              let match = regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
              match.numberOfRanges > 1,
              let r = Range(match.range(at: 1), in: trimmed)
        else { return false }
        return Self.videoId(from: String(trimmed[r])) == expectedId
    }
}

public struct YouTubeTranscriptCue: Codable, Hashable, Sendable {
    public var startMs: Int
    public var text: String
}

public struct YouTubeTranscriptResponse: Codable, Sendable {
    public var videoId: String
    public var cues: [YouTubeTranscriptCue]
}
