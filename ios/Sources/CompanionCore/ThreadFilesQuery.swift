import Foundation

// The open conversation's files as the bot panel's Files section shows them
// (matrix rows BF1, BF3, BF4): which kind each file is, the kind chips with
// their counts, who sent it, the search, the sort, and the path a person can
// copy. A port of the desktop's `src/lib/chat-files.ts` and the
// `copyablePath` of `bot-settings/FilesSection.tsx`, so a chip count and
// the list under it agree on both.

/// `FileKind`.
public enum ThreadFileKind: String, CaseIterable, Hashable, Sendable {
    case image, video, audio, document, code, archive, other
}

/// The chips, in order (`FILE_FILTERS`). Archives fold into Other.
public enum ThreadFileFilter: String, CaseIterable, Hashable, Sendable {
    case all, image, video, audio, document, code, other
}

/// `FileOrigin`: everyone, the bot's, or the person's own uploads.
public enum ThreadFileOrigin: String, CaseIterable, Hashable, Sendable {
    case all, bot, you
}

/// `FileSort`.
public enum ThreadFileSort: String, CaseIterable, Hashable, Sendable {
    case newest, name, size
}

public struct ThreadFileQuery: Hashable, Sendable {
    public var filter: ThreadFileFilter
    public var origin: ThreadFileOrigin
    public var search: String
    public var sort: ThreadFileSort

    public init(filter: ThreadFileFilter = .all, origin: ThreadFileOrigin = .all, search: String = "", sort: ThreadFileSort = .newest) {
        self.filter = filter
        self.origin = origin
        self.search = search
        self.sort = sort
    }
}

public enum ThreadFileRules {
    private static let documentMimes: Set<String> = [
        "application/pdf", "application/rtf", "application/msword", "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint", "application/epub+zip", "text/plain", "text/markdown", "text/csv",
        "text/tab-separated-values", "text/rtf",
    ]
    private static let codeMimes: Set<String> = [
        "application/json", "application/ld+json", "application/javascript", "application/typescript",
        "application/xml", "application/x-sh", "application/x-httpd-php", "application/sql", "application/toml",
        "application/yaml", "application/x-yaml", "text/javascript", "text/typescript", "text/html", "text/css",
        "text/xml", "text/yaml",
    ]
    private static let archiveMimes: Set<String> = [
        "application/zip", "application/gzip", "application/x-gzip", "application/x-tar",
        "application/x-7z-compressed", "application/x-rar-compressed", "application/vnd.rar", "application/x-bzip2",
        "application/x-xz", "application/zstd", "application/java-archive", "application/x-apple-diskimage",
    ]
    private static let extensionKind: [String: ThreadFileKind] = {
        var map: [String: ThreadFileKind] = [:]
        for ext in ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "heic", "heif", "tif", "tiff", "svg", "ico"] { map[ext] = .image }
        for ext in ["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "mpeg", "mpg"] { map[ext] = .video }
        for ext in ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "aiff", "aif", "wma"] { map[ext] = .audio }
        for ext in [
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "md", "markdown",
            "csv", "tsv", "pages", "numbers", "key", "epub", "log",
        ] { map[ext] = .document }
        for ext in [
            "js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts", "json", "jsonc", "yaml", "yml", "toml", "xml", "html", "htm",
            "css", "scss", "sass", "less", "py", "rb", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp",
            "cs", "php", "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd", "sql", "lua", "r", "dart", "scala", "vue",
            "svelte", "ini", "env", "ipynb", "graphql", "gql", "proto", "dockerfile", "makefile", "gradle", "tf", "diff", "patch",
        ] { map[ext] = .code }
        for ext in ["zip", "gz", "tgz", "tar", "7z", "rar", "bz2", "xz", "zst", "jar", "dmg", "iso"] { map[ext] = .archive }
        return map
    }()

    /// The lowercase extension ("Dockerfile" and "Makefile" count as their own).
    public static func fileExtension(_ name: String) -> String {
        let base = (name.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? "").lowercased()
        if base == "dockerfile" || base == "makefile" { return base }
        guard let dot = base.lastIndex(of: "."), dot > base.startIndex else { return "" }
        return String(base[base.index(after: dot)...])
    }

    private static func kind(fromMime raw: String?) -> ThreadFileKind? {
        guard let mime = raw?.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespaces).lowercased(),
              !mime.isEmpty, mime != "application/octet-stream", mime != "binary/octet-stream" else { return nil }
        if mime.hasPrefix("image/") { return .image }
        if mime.hasPrefix("video/") { return .video }
        if mime.hasPrefix("audio/") { return .audio }
        if archiveMimes.contains(mime) { return .archive }
        if codeMimes.contains(mime) || mime.hasPrefix("text/x-") || mime.hasSuffix("+json") || mime.hasSuffix("+xml") { return .code }
        if documentMimes.contains(mime)
            || mime.hasPrefix("application/vnd.openxmlformats-officedocument.")
            || mime.hasPrefix("application/vnd.oasis.opendocument.") { return .document }
        if mime.hasPrefix("text/") { return .document }
        return nil
    }

    /// The type first; the extension decides when it is missing or only
    /// says "bytes". Anything still unknown is Other (`classifyFile`).
    public static func kind(name: String, mime: String?) -> ThreadFileKind {
        kind(fromMime: mime) ?? extensionKind[fileExtension(name)] ?? .other
    }

    public static func kind(of file: ThreadFile) -> ThreadFileKind { kind(name: file.name, mime: file.mime) }

    public static func filter(for kind: ThreadFileKind) -> ThreadFileFilter {
        switch kind {
        case .image: .image
        case .video: .video
        case .audio: .audio
        case .document: .document
        case .code: .code
        case .archive, .other: .other
        }
    }

    /// An upload is the person's; everything else the bot's (`originOf`).
    public static func origin(of file: ThreadFile) -> ThreadFileOrigin { file.source == .upload ? .you : .bot }

    private static func matches(_ file: ThreadFile, origin: ThreadFileOrigin, search: String) -> Bool {
        if origin != .all, self.origin(of: file) != origin { return false }
        let needle = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return needle.isEmpty || file.name.lowercased().contains(needle)
    }

    /// How many files each chip would show under the search and origin.
    public static func counts(_ files: [ThreadFile], origin: ThreadFileOrigin, search: String) -> [ThreadFileFilter: Int] {
        var counts = Dictionary(uniqueKeysWithValues: ThreadFileFilter.allCases.map { ($0, 0) })
        for file in files where matches(file, origin: origin, search: search) {
            counts[.all, default: 0] += 1
            counts[filter(for: kind(of: file)), default: 0] += 1
        }
        return counts
    }

    /// The chips on screen: only kinds that have files (or the selected one),
    /// and only when there are two kinds or more to choose between.
    public static func visibleFilters(counts: [ThreadFileFilter: Int], selected: ThreadFileFilter) -> [ThreadFileFilter] {
        let kinds = ThreadFileFilter.allCases.filter { $0 != .all && ((counts[$0] ?? 0) > 0 || $0 == selected) }
        return kinds.count >= 2 ? [.all] + kinds : []
    }

    /// Ordered as asked; unknown sizes last; newest first among equals.
    public static func sorted(_ files: [ThreadFile], by sort: ThreadFileSort) -> [ThreadFile] {
        let indexed = Array(files.enumerated())
        return indexed.sorted { lhs, rhs in
            let a = lhs.element, b = rhs.element
            switch sort {
            case .name:
                let order = a.name.compare(b.name, options: [.caseInsensitive, .numeric, .diacriticInsensitive])
                if order != .orderedSame { return order == .orderedAscending }
            case .size:
                switch (a.size, b.size) {
                case let (x?, y?) where x != y: return x > y
                case (nil, _?): return false
                case (_?, nil): return true
                default: break
                }
            case .newest: break
            }
            if a.at != b.at { return a.at > b.at }
            return lhs.offset < rhs.offset
        }.map(\.element)
    }

    /// The list under the chips (`visibleFiles`).
    public static func visible(_ files: [ThreadFile], query: ThreadFileQuery) -> [ThreadFile] {
        sorted(
            files.filter { file in
                matches(file, origin: query.origin, search: query.search)
                    && (query.filter == .all || filter(for: kind(of: file)) == query.filter)
            },
            by: query.sort
        )
    }

    /// A readable local path a person can paste somewhere: an absolute POSIX
    /// or Windows path, or a file:// URL. Relative spellings are not offered.
    public static func copyablePath(_ path: String) -> String? {
        if path.lowercased().hasPrefix("file://") {
            guard let url = URL(string: path) else { return nil }
            let raw = url.path(percentEncoded: true)
            let decoded = raw.removingPercentEncoding ?? raw
            if decoded.range(of: #"^/[A-Za-z]:[\\/]"#, options: .regularExpression) != nil {
                return String(decoded.dropFirst())
            }
            return decoded.isEmpty ? nil : decoded
        }
        if path.hasPrefix("/") || path.hasPrefix("\\\\") { return path }
        let chars = Array(path)
        if chars.count >= 3, chars[0].isLetter, chars[0].isASCII, chars[1] == ":", chars[2] == "/" || chars[2] == "\\" { return path }
        return nil
    }

    /// The path the file's Copy path copies, when it has one.
    public static func copyablePath(of file: ThreadFile) -> String? {
        guard file.available else { return nil }
        return copyablePath(file.localPath ?? file.path)
    }
}
