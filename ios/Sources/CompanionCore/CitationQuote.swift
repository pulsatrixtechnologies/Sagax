// Quote selected text as a citation (feature parity matrix CO8), the port of
// src/lib/citations.ts: the attachment a selection becomes, the selector that
// finds it again in the source message, how it travels inside the prompt
// (`serializeCitation`) and how a sent message gives it back
// (`splitTranscriptCitations`). Offsets and lengths count UTF-16 units, as
// the desktop's JavaScript strings do, so a citation made on the phone lands
// on the same characters when the desktop goes to its source.
import Foundation

/// Where a citation was taken from (`CitationSource`).
public struct CitationSource: Codable, Hashable, Sendable {
    public enum OwnerType: String, Codable, Hashable, Sendable {
        case bot
        case group
    }

    public var ownerType: OwnerType
    public var ownerId: String
    public var threadId: String
    public var messageId: String
    public var start: Int
    public var end: Int
    public var prefix: String
    public var suffix: String

    public init(
        ownerType: OwnerType, ownerId: String, threadId: String, messageId: String,
        start: Int = 0, end: Int = 0, prefix: String = "", suffix: String = ""
    ) {
        self.ownerType = ownerType
        self.ownerId = ownerId
        self.threadId = threadId
        self.messageId = messageId
        self.start = start
        self.end = end
        self.prefix = prefix
        self.suffix = suffix
    }
}

/// The selected words and the context around them (`CitationTextSelector`).
public struct CitationTextSelector: Hashable, Sendable {
    public var text: String
    public var start: Int
    public var end: Int
    public var prefix: String
    public var suffix: String
}

/// A quote waiting in the composer or carried by a sent message
/// (`CitationAttachment`, kind "citation", version 1).
public struct CitationAttachment: Codable, Hashable, Identifiable, Sendable {
    public var kind = "citation"
    public var version = 1
    public var id: String
    public var quote: String
    public var comment: String?
    public var source: CitationSource
    public var size: Int

    enum CodingKeys: String, CodingKey {
        case kind, version, id, quote, comment, source, size
    }
}

extension Citations {
    /// `CITATION_MAX_QUOTE_LENGTH` and `CITATION_MAX_COMMENT_LENGTH`.
    public static let maxQuoteLength = 12_000
    public static let maxCommentLength = 4_000
    static let contextLength = 64
    static let markerPrefix = "<!--omb-citation-v1:"
    private static let markerPattern = try! NSRegularExpression(pattern: #"<!--omb-citation-v1:([A-Za-z0-9_-]{1,100000})-->"#)
    /// JavaScript's `\s`, so whitespace folds exactly as on the desktop.
    private static let jsSpace = #"[\t\n\u000B\f\r    -     　﻿]"#
    private static let spaceRun = try! NSRegularExpression(pattern: jsSpace + "+")
    private static let spaceUnits: Set<unichar> = {
        var units: Set<unichar> = [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF]
        for unit in unichar(0x2000)...unichar(0x200A) { units.insert(unit) }
        return units
    }()

    /// A string's length as JavaScript counts it.
    public static func jsLength(_ text: String) -> Int { text.utf16.count }

    /// `normalizeWhitespace`: every run of whitespace becomes one space.
    static func normalizeWhitespace(_ text: String) -> String {
        let ns = text as NSString
        return spaceRun.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: ns.length), withTemplate: " ")
    }

    private static func splitsSurrogatePair(_ text: NSString, _ offset: Int) -> Bool {
        guard offset > 0, offset < text.length else { return false }
        let before = text.character(at: offset - 1), after = text.character(at: offset)
        return (0xD800...0xDBFF).contains(before) && (0xDC00...0xDFFF).contains(after)
    }

    /// `createCitationTextSelector`: the selected UTF-16 range of `text`, with
    /// its offsets and 64 characters of context in the whitespace-folded text.
    /// Nil for an empty or blank selection.
    public static func selector(in text: String, start rawStart: Int, end rawEnd: Int) -> CitationTextSelector? {
        let ns = text as NSString
        guard rawStart >= 0, rawEnd <= ns.length, rawStart < rawEnd else { return nil }
        let quote = ns.substring(with: NSRange(location: rawStart, length: rawEnd - rawStart))
        guard !quote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let normalized = normalizeWhitespace(text) as NSString
        var start = (normalizeWhitespace(ns.substring(to: rawStart)) as NSString).length
        if rawStart > 0, rawStart < ns.length,
           spaceUnits.contains(ns.character(at: rawStart - 1)), spaceUnits.contains(ns.character(at: rawStart)) {
            start -= 1
        }
        let end = (normalizeWhitespace(ns.substring(to: rawEnd)) as NSString).length
        var prefixStart = max(0, start - contextLength)
        var suffixEnd = min(normalized.length, end + contextLength)
        if splitsSurrogatePair(normalized, prefixStart) { prefixStart += 1 }
        if splitsSurrogatePair(normalized, suffixEnd) { suffixEnd -= 1 }
        return CitationTextSelector(
            text: quote,
            start: start,
            end: end,
            prefix: normalized.substring(with: NSRange(location: prefixStart, length: max(0, start - prefixStart))),
            suffix: normalized.substring(with: NSRange(location: end, length: max(0, suffixEnd - end)))
        )
    }

    /// `citationAttachment`: nil when the quote is blank or longer than
    /// 12,000 characters, or the comment longer than 4,000.
    public static func attachment(
        source: CitationSource, selector: CitationTextSelector, comment: String = "", id: String = UUID().uuidString.lowercased()
    ) -> CitationAttachment? {
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selector.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              jsLength(selector.text) <= maxQuoteLength,
              jsLength(trimmed) <= maxCommentLength
        else { return nil }
        var located = source
        located.start = selector.start
        located.end = selector.end
        located.prefix = selector.prefix
        located.suffix = selector.suffix
        return CitationAttachment(
            id: id,
            quote: selector.text,
            comment: trimmed.isEmpty ? nil : trimmed,
            source: located,
            size: selector.text.utf8.count + trimmed.utf8.count
        )
    }

    /// `withCitationComment`: the same quote with a new comment (an empty one
    /// removes it). Nil when the comment is too long.
    public static func withComment(_ citation: CitationAttachment, _ comment: String) -> CitationAttachment? {
        let trimmed = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard jsLength(trimmed) <= maxCommentLength else { return nil }
        var next = citation
        next.comment = trimmed.isEmpty ? nil : trimmed
        next.size = citation.quote.utf8.count + trimmed.utf8.count
        return next
    }

    /// `citationFallback`: readable where no citation UI exists.
    public static func fallback(_ citation: CitationAttachment) -> String {
        let quote = citation.quote.components(separatedBy: "\n").map { "> \($0)" }.joined(separator: "\n")
        return "> Quoted message:\n\(quote)" + (citation.comment.map { "\n\nComment:\n\($0)" } ?? "")
    }

    /// `serializeCitation`: the hidden marker, then the readable fallback.
    public static func serialize(_ citation: CitationAttachment) -> String {
        let encoded = Data(json(citation).utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return "\(markerPrefix)\(encoded)-->\n\(fallback(citation))"
    }

    /// `JSON.stringify` of the attachment, keys in the desktop's order, so
    /// the marker is byte for byte the one the desktop writes.
    static func json(_ citation: CitationAttachment) -> String {
        let source = citation.source
        let sourceJSON = "{\"ownerType\":\(jsString(source.ownerType.rawValue)),\"ownerId\":\(jsString(source.ownerId)),"
            + "\"threadId\":\(jsString(source.threadId)),\"messageId\":\(jsString(source.messageId)),"
            + "\"start\":\(source.start),\"end\":\(source.end),\"prefix\":\(jsString(source.prefix)),\"suffix\":\(jsString(source.suffix))}"
        var out = "{\"kind\":\(jsString(citation.kind)),\"version\":\(citation.version),\"id\":\(jsString(citation.id)),\"quote\":\(jsString(citation.quote)),"
        if let comment = citation.comment { out += "\"comment\":\(jsString(comment))," }
        return out + "\"source\":\(sourceJSON),\"size\":\(citation.size)}"
    }

    /// A JSON string literal as `JSON.stringify` writes it.
    static func jsString(_ value: String) -> String {
        var out = "\""
        for unit in value.unicodeScalars {
            switch unit {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if unit.value < 0x20 {
                    out += String(format: "\\u%04x", unit.value)
                } else {
                    out.unicodeScalars.append(unit)
                }
            }
        }
        return out + "\""
    }

    /// `composeMessage` for citations: the text, then one block per citation.
    /// The blocks are not trimmed, so the desktop recognizes them exactly.
    public static func compose(_ text: String, citations: [CitationAttachment]) -> String {
        let parts = [text.trimmingCharacters(in: .whitespacesAndNewlines)] + citations.map(serialize)
        return parts.filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    /// `splitTranscriptCitations`: a sent message's own words, and the
    /// citations it carries, in order.
    public static func split(_ text: String) -> (display: String, citations: [CitationAttachment]) {
        let ns = text as NSString
        var citations: [CitationAttachment] = []
        var display = ""
        var cursor = 0
        for match in markerPattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            guard match.range.location >= cursor,
                  let citation = decodeAttachment(ns.substring(with: match.range(at: 1)))
            else { continue }
            let block = ns.substring(with: match.range) + "\n" + fallback(citation)
            guard ns.substring(from: match.range.location).hasPrefix(block) else { continue }
            display += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            cursor = match.range.location + (block as NSString).length
            citations.append(citation)
        }
        guard !citations.isEmpty else { return (text, []) }
        display += ns.substring(from: cursor)
        return (display.trimmingCharacters(in: .whitespacesAndNewlines), citations)
    }

    /// `isCitationAttachment` on the decoded marker.
    static func decodeAttachment(_ value: String) -> CitationAttachment? {
        var base = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base.count % 4 != 0 { base += "=" }
        guard let data = Data(base64Encoded: base),
              let citation = try? JSONDecoder().decode(CitationAttachment.self, from: data)
        else { return nil }
        func bounded(_ value: String, _ max: Int, empty: Bool = false) -> Bool {
            jsLength(value) <= max && (empty || !value.isEmpty)
        }
        let source = citation.source
        guard citation.kind == "citation", citation.version == 1,
              bounded(citation.id, 200), bounded(citation.quote, maxQuoteLength),
              citation.comment.map({ bounded($0, maxCommentLength, empty: true) }) ?? true,
              citation.size >= 0,
              bounded(source.ownerId, 200), bounded(source.threadId, 200), bounded(source.messageId, 200),
              source.start >= 0, source.end >= source.start,
              bounded(source.prefix, contextLength, empty: true), bounded(source.suffix, contextLength, empty: true)
        else { return nil }
        return citation
    }
}
