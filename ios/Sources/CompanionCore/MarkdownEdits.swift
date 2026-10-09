// The pure text edits behind the markdown editor, ported from the desktop's
// `src/components/markdown/markdown-edits.ts` (docs/markdown-editor.md): the
// toolbar actions, list continuation on Return, nesting in lists, link and
// table paste, the counts and the Format action. Each edit takes the whole
// text and a selection and returns the new text and selection, so the same
// code drives the iOS text view and the unit tests.
//
// Offsets are UTF-16 code units, the unit of `NSRange` and `UITextView`, so
// a selection travels between the view and these functions unchanged.
import Foundation

public enum MarkdownEdits {
    public struct TextSelection: Equatable, Sendable {
        public var doc: String
        /// Selection start (inclusive), UTF-16 offset.
        public var from: Int
        /// Selection end (exclusive); equal to `from` for a caret.
        public var to: Int

        public init(doc: String, from: Int, to: Int) {
            self.doc = doc
            self.from = from
            self.to = to
        }

        public init(doc: String, caret: Int) {
            self.init(doc: doc, from: caret, to: caret)
        }
    }

    public enum LineKind: String, Sendable { case bullet, numbered, task, quote }

    // MARK: - Patterns (the desktop's, same groups)

    private static func regex(_ pattern: String) -> NSRegularExpression {
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern)
    }

    private static let bulletRE = regex(#"^(\s*)([-*+])(\s+)"#)
    private static let orderedRE = regex(#"^(\s*)(\d{1,9})([.)])(\s+)"#)
    private static let taskRE = regex(#"^(\s*)([-*+])(\s+)\[([ xX])\](\s+|$)"#)
    private static let quoteRE = regex(#"^(\s*)((?:>\s?)+)"#)
    private static let headingRE = regex(#"^(#{1,6})(\s+|$)"#)
    private static let fenceRE = regex(#"^\s{0,3}(`{3,}|~{3,})"#)
    private static let thematicRE = regex(#"^\s{0,3}([-*_])(?:\s*\1){2,}\s*$"#)
    private static let urlOnlyRE = try! NSRegularExpression(pattern: #"^(?:https?://|mailto:)[^\s<>()]+$"#, options: [.caseInsensitive])

    /// Groups of the first match of `re` in `text` (index 0 the whole match),
    /// nil for a group that did not take part.
    private static func match(_ re: NSRegularExpression, _ text: String) -> [String?]? {
        let ns = text as NSString
        guard let result = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (0..<result.numberOfRanges).map { index in
            let range = result.range(at: index)
            return range.location == NSNotFound ? nil : ns.substring(with: range)
        }
    }

    private static func test(_ re: NSRegularExpression, _ text: String) -> Bool { match(re, text) != nil }

    // MARK: - UTF-16 helpers

    private static func len(_ s: String) -> Int { (s as NSString).length }

    private static func slice(_ s: String, _ from: Int, _ to: Int? = nil) -> String {
        let ns = s as NSString
        let start = max(0, min(from, ns.length))
        let end = max(start, min(to ?? ns.length, ns.length))
        return ns.substring(with: NSRange(location: start, length: end - start))
    }

    private static func char(_ s: String, _ at: Int) -> String {
        let ns = s as NSString
        guard at >= 0, at < ns.length else { return "" }
        return ns.substring(with: NSRange(location: at, length: 1))
    }

    private static func isSpace(_ c: String) -> Bool {
        c.unicodeScalars.allSatisfy { CharacterSet.whitespacesAndNewlines.contains($0) } && !c.isEmpty
    }

    static func lineStartAt(_ doc: String, _ pos: Int) -> Int {
        let ns = doc as NSString
        guard pos > 0 else { return 0 }
        let range = ns.range(of: "\n", options: .backwards, range: NSRange(location: 0, length: min(pos, ns.length)))
        return range.location == NSNotFound ? 0 : range.location + 1
    }

    static func lineEndAt(_ doc: String, _ pos: Int) -> Int {
        let ns = doc as NSString
        let start = max(0, min(pos, ns.length))
        let range = ns.range(of: "\n", range: NSRange(location: start, length: ns.length - start))
        return range.location == NSNotFound ? ns.length : range.location
    }

    private static func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    private static func leadingWhitespace(_ s: String) -> String {
        String(s.prefix { $0 == " " || $0 == "\t" })
    }

    private static func dropTrailingBlanks(_ s: String) -> String {
        var out = s
        while let last = out.last, last == " " || last == "\t" { out.removeLast() }
        return out
    }

    // MARK: - Fences

    /// True when `pos` sits inside a fenced code block.
    public static func insideFence(_ doc: String, _ pos: Int) -> Bool {
        let before = slice(doc, 0, lineStartAt(doc, pos))
        var open: String?
        for line in before.components(separatedBy: "\n") {
            guard let m = match(fenceRE, line), let marker = m[1] else { continue }
            if let current = open {
                if marker.first == current.first, marker.count >= current.count, trimmed(line) == marker { open = nil }
            } else {
                open = marker
            }
        }
        return open != nil
    }

    // MARK: - Inline wraps

    /// Wrap or unwrap the selection with `marker` (`**`, `_` or a backtick).
    /// Spaces at the ends stay outside; a caret inserts `placeholder`
    /// between the markers and selects it.
    public static func toggleWrap(_ state: TextSelection, marker: String, placeholder: String) -> TextSelection {
        let doc = state.doc
        var from = state.from
        var to = state.to
        while from < to, isSpace(char(doc, from)) { from += 1 }
        while to > from, isSpace(char(doc, to - 1)) { to -= 1 }
        let m = len(marker)
        if from - m >= 0, slice(doc, from - m, from) == marker, slice(doc, to, to + m) == marker {
            let next = slice(doc, 0, from - m) + slice(doc, from, to) + slice(doc, to + m)
            return TextSelection(doc: next, from: from - m, to: to - m)
        }
        let selected = slice(doc, from, to)
        if len(selected) >= 2 * m + 1, selected.hasPrefix(marker), selected.hasSuffix(marker) {
            let inner = slice(selected, m, len(selected) - m)
            return TextSelection(doc: slice(doc, 0, from) + inner + slice(doc, to), from: from, to: from + len(inner))
        }
        if from == to {
            let next = slice(doc, 0, from) + marker + placeholder + marker + slice(doc, to)
            return TextSelection(doc: next, from: from + m, to: from + m + len(placeholder))
        }
        let next = slice(doc, 0, from) + marker + selected + marker + slice(doc, to)
        return TextSelection(doc: next, from: from + m, to: to + m)
    }

    /// Inline code for a selection on one line, a fenced block for several.
    public static func toggleCode(_ state: TextSelection, placeholder: String) -> TextSelection {
        let selected = slice(state.doc, state.from, state.to)
        if !selected.contains("\n") { return toggleWrap(state, marker: "`", placeholder: placeholder) }
        let doc = state.doc
        let start = lineStartAt(doc, state.from)
        let end = lineEndAt(doc, state.to)
        let body = slice(doc, start, end)
        let lines = body.components(separatedBy: "\n")
        if lines.count >= 2, test(fenceRE, lines[0]), test(fenceRE, lines[lines.count - 1]) {
            let inner = lines.dropFirst().dropLast().joined(separator: "\n")
            return TextSelection(doc: slice(doc, 0, start) + inner + slice(doc, end), from: start, to: start + len(inner))
        }
        let block = "```\n" + body + "\n```"
        return TextSelection(doc: slice(doc, 0, start) + block + slice(doc, end), from: start + 4, to: start + 4 + len(body))
    }

    /// An empty fenced code block at the caret, the caret inside it.
    public static func insertCodeBlock(_ state: TextSelection) -> TextSelection {
        if state.from != state.to { return toggleCode(state, placeholder: "") }
        return insertBlock(state, block: "```\n\n```", selectFrom: 4, selectTo: 4)
    }

    // MARK: - Line prefixes

    struct ParsedLine {
        var indent: String
        var marker: String
        var kind: LineKind?
        var rest: String
    }

    static func parseLine(_ line: String) -> ParsedLine {
        func parsed(_ m: [String?], _ kind: LineKind) -> ParsedLine {
            let whole = m[0] ?? ""
            let indent = m[1] ?? ""
            return ParsedLine(indent: indent, marker: slice(whole, len(indent)), kind: kind, rest: slice(line, len(whole)))
        }
        if let m = match(taskRE, line) { return parsed(m, .task) }
        if let m = match(orderedRE, line) { return parsed(m, .numbered) }
        if !test(thematicRE, line), let m = match(bulletRE, line) { return parsed(m, .bullet) }
        if let m = match(quoteRE, line) { return parsed(m, .quote) }
        let indent = String(line.prefix { $0.isWhitespace && $0 != "\n" })
        return ParsedLine(indent: indent, marker: "", kind: nil, rest: slice(line, len(indent)))
    }

    private static func markerFor(_ kind: LineKind, _ index: Int) -> String {
        switch kind {
        case .bullet: return "- "
        case .numbered: return "\(index + 1). "
        case .task: return "- [ ] "
        case .quote: return "> "
        }
    }

    private static func selectionAfterLineEdit(_ oldLines: [String], _ newLines: [String], _ blockStart: Int, _ state: TextSelection) -> (Int, Int) {
        func map(_ pos: Int) -> Int {
            var oldOffset = blockStart
            var newOffset = blockStart
            for index in oldLines.indices {
                let oldLine = len(oldLines[index])
                let newLine = len(newLines[index])
                if pos <= oldOffset + oldLine {
                    let column = pos - oldOffset
                    let delta = newLine - oldLine
                    let low = min(column, newLine)
                    return newOffset + min(max(column + delta, low), newLine)
                }
                oldOffset += oldLine + 1
                newOffset += newLine + 1
            }
            return newOffset - 1
        }
        return (map(state.from), map(state.to))
    }

    /// Make every selected line a bullet, numbered, task or quote line, or
    /// remove that marker when every non-empty line already has it.
    public static func toggleLinePrefix(_ state: TextSelection, kind: LineKind) -> TextSelection {
        let doc = state.doc
        let start = lineStartAt(doc, state.from)
        let back = state.to > state.from && char(doc, state.to - 1) == "\n" ? 1 : 0
        let end = lineEndAt(doc, max(state.from, state.to - back))
        let oldLines = slice(doc, start, end).components(separatedBy: "\n")
        let parsed = oldLines.map(parseLine)
        let content = parsed.filter { trimmed($0.rest) != "" || $0.marker != "" }
        let all = !content.isEmpty && content.allSatisfy { $0.kind == kind }
        var counter = 0
        let newLines: [String] = oldLines.enumerated().map { index, line in
            let info = parsed[index]
            let empty = trimmed(info.rest) == "" && info.marker == ""
            if empty && oldLines.count > 1 { return line }
            if all { return info.indent + info.rest }
            if kind == .quote { return info.indent + "> " + info.marker + info.rest }
            let marker = markerFor(kind, counter)
            counter += 1
            if info.kind == .quote { return info.indent + info.marker + marker + info.rest }
            return info.indent + marker + info.rest
        }
        let next = slice(doc, 0, start) + newLines.joined(separator: "\n") + slice(doc, end)
        let (from, to) = selectionAfterLineEdit(oldLines, newLines, start, state)
        return TextSelection(doc: next, from: from, to: to)
    }

    private static func headingLevel(_ line: String) -> Int { match(headingRE, line)?[1].map { $0.count } ?? 0 }

    /// Set the heading level of the selected lines; the same level again
    /// removes it. Level 0 removes any heading.
    public static func setHeading(_ state: TextSelection, level: Int) -> TextSelection {
        let doc = state.doc
        let start = lineStartAt(doc, state.from)
        let end = lineEndAt(doc, state.to)
        let oldLines = slice(doc, start, end).components(separatedBy: "\n")
        let same = oldLines.allSatisfy { headingLevel($0) == level }
        let newLines = oldLines.map { line -> String in
            let whole = match(headingRE, line)?[0] ?? ""
            let bare = slice(line, len(whole))
            if same || level == 0 { return bare }
            return String(repeating: "#", count: level) + " " + bare
        }
        let next = slice(doc, 0, start) + newLines.joined(separator: "\n") + slice(doc, end)
        let (from, to) = selectionAfterLineEdit(oldLines, newLines, start, state)
        return TextSelection(doc: next, from: from, to: to)
    }

    /// The toolbar's heading button: none, H1, H2, H3, then none again.
    public static func cycleHeading(_ state: TextSelection) -> TextSelection {
        let line = slice(state.doc, lineStartAt(state.doc, state.from), lineEndAt(state.doc, state.from))
        let level = headingLevel(line)
        let next = level >= 3 ? 0 : level + 1
        return setHeading(state, level: next == 0 ? level : next)
    }

    // MARK: - Link, table, rule

    public static func isUrl(_ text: String) -> Bool { test(urlOnlyRE, trimmed(text)) }

    /// The selection becomes the link text (or the address when it is one)
    /// and the part left to fill is selected.
    public static func insertLink(_ state: TextSelection, textPlaceholder: String) -> TextSelection {
        let doc = state.doc
        let from = state.from
        let to = state.to
        let selected = slice(doc, from, to)
        if isUrl(selected) {
            let url = trimmed(selected)
            let next = slice(doc, 0, from) + "[\(textPlaceholder)](\(url))" + slice(doc, to)
            return TextSelection(doc: next, from: from + 1, to: from + 1 + len(textPlaceholder))
        }
        let text = selected.isEmpty ? textPlaceholder : selected
        let url = "https://"
        let next = slice(doc, 0, from) + "[\(text)](\(url))" + slice(doc, to)
        if selected.isEmpty { return TextSelection(doc: next, from: from + 1, to: from + 1 + len(text)) }
        let urlStart = from + len(text) + 3
        return TextSelection(doc: next, from: urlStart, to: urlStart + len(url))
    }

    static func insertBlock(_ state: TextSelection, block: String, selectFrom: Int, selectTo: Int) -> TextSelection {
        let doc = state.doc
        let at = state.to
        let lineStart = lineStartAt(doc, at)
        let lineEnd = lineEndAt(doc, at)
        let lineEmpty = trimmed(slice(doc, lineStart, lineEnd)).isEmpty
        let insertAt = lineEmpty ? lineStart : lineEnd
        let before = slice(doc, 0, insertAt)
        let after = slice(doc, lineEmpty ? lineEnd : insertAt)
        var prefix = ""
        if !before.isEmpty, !before.hasSuffix("\n\n") { prefix = before.hasSuffix("\n") ? "\n" : "\n\n" }
        var suffix = ""
        if after.isEmpty { suffix = "\n" } else if !after.hasPrefix("\n\n") { suffix = after.hasPrefix("\n") ? "\n" : "\n\n" }
        let next = before + prefix + block + suffix + after
        let base = len(before) + len(prefix)
        return TextSelection(doc: next, from: base + selectFrom, to: base + selectTo)
    }

    public static func insertTable(_ state: TextSelection, column: (Int) -> String) -> TextSelection {
        let a = column(1)
        let b = column(2)
        let block = "| \(a) | \(b) |\n| --- | --- |\n|  |  |"
        return insertBlock(state, block: block, selectFrom: 2, selectTo: 2 + len(a))
    }

    public static func insertRule(_ state: TextSelection) -> TextSelection {
        insertBlock(state, block: "---", selectFrom: 3, selectTo: 3)
    }

    // MARK: - Return and nesting in lists

    /// Return inside a list or a quote: the next line gets the same marker
    /// (the next number, an unchecked box). Return on an empty item ends the
    /// list, or moves a nested item one level out. Nil for the usual newline.
    public static func continueList(_ state: TextSelection) -> TextSelection? {
        let doc = state.doc
        let from = state.from
        let to = state.to
        guard from == to, !insideFence(doc, from) else { return nil }
        let start = lineStartAt(doc, from)
        let end = lineEndAt(doc, from)
        let line = slice(doc, start, end)
        let info = parseLine(line)
        guard let kind = info.kind else { return nil }
        let markerEnd = start + len(info.indent) + len(info.marker)
        if from < markerEnd { return nil }
        if trimmed(info.rest).isEmpty, from == end {
            if !info.indent.isEmpty, kind != .quote { return indentList(state, direction: -1) }
            let next = slice(doc, 0, start) + slice(doc, end)
            return TextSelection(doc: next, caret: start)
        }
        var marker = info.marker
        if kind == .numbered, let m = match(orderedRE, line) {
            let number = (Int(m[2] ?? "0") ?? 0) + 1
            let gap = (m[4] ?? " ").contains("\t") ? (m[4] ?? " ") : " "
            marker = "\(number)\(m[3] ?? ".")\(gap)"
        } else if kind == .task, let m = match(taskRE, line) {
            marker = "\(m[2] ?? "-")\(m[3] ?? " ")[ ] "
        }
        let insert = "\n" + info.indent + marker
        var after = slice(doc, to)
        while let first = after.first, first == " " || first == "\t" { after.removeFirst() }
        let head = dropTrailingBlanks(slice(doc, 0, from))
        let caret = len(head) + len(insert)
        return TextSelection(doc: head + insert + after, caret: caret)
    }

    /// Nest list lines under the item above (direction 1) or move them one
    /// level out (-1). Nil when no selected line is a list line.
    public static func indentList(_ state: TextSelection, direction: Int) -> TextSelection? {
        let doc = state.doc
        if insideFence(doc, state.from) { return nil }
        let start = lineStartAt(doc, state.from)
        let end = lineEndAt(doc, state.to)
        let oldLines = slice(doc, start, end).components(separatedBy: "\n")
        let parsed = oldLines.map(parseLine)
        guard parsed.contains(where: { $0.kind != nil && $0.kind != .quote }) else { return nil }
        let above = Array(slice(doc, 0, max(0, start - 1)).components(separatedBy: "\n").reversed())
        func parent(_ indent: Int, deeper: Bool) -> ParsedLine? {
            for text in above {
                if trimmed(text).isEmpty { continue }
                let line = parseLine(text)
                if line.kind == nil || line.kind == .quote {
                    if line.indent.isEmpty { return nil }
                    continue
                }
                if deeper ? len(line.indent) <= indent : len(line.indent) < indent { return line }
            }
            return nil
        }
        let newLines: [String] = oldLines.enumerated().map { index, line in
            let info = parsed[index]
            guard info.kind != nil, info.kind != .quote else { return line }
            let width = len(info.indent.replacingOccurrences(of: "\t", with: "    "))
            var target: Int
            if direction == 1 {
                let p = parent(width, deeper: true)
                target = p.map { len($0.indent) + len($0.marker) } ?? width + 2
                if target <= width { target = width + 2 }
            } else {
                if width == 0 { return line }
                target = parent(width, deeper: false).map { len($0.indent) } ?? 0
            }
            return String(repeating: " ", count: target) + info.marker + info.rest
        }
        if newLines == oldLines { return direction == -1 ? state : nil }
        let next = slice(doc, 0, start) + newLines.joined(separator: "\n") + slice(doc, end)
        let (from, to) = selectionAfterLineEdit(oldLines, newLines, start, state)
        return TextSelection(doc: next, from: from, to: to)
    }

    // MARK: - Paste

    /// A URL pasted over selected text on one line becomes a link.
    public static func linkFromPaste(selected: String, pasted: String) -> String? {
        guard !trimmed(selected).isEmpty, !selected.contains("\n"), !isUrl(selected), isUrl(pasted) else { return nil }
        return "[\(selected)](\(trimmed(pasted)))"
    }

    /// Tab-separated rows (a spreadsheet copy) become a table, first row as
    /// header. Nil for anything else.
    public static func tableFromTsv(_ pasted: String) -> String? {
        var text = pasted.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        while text.hasSuffix("\n") { text.removeLast() }
        let rows = text.components(separatedBy: "\n")
        guard rows.count >= 2, rows.allSatisfy({ $0.contains("\t") }) else { return nil }
        let cells = rows.map { row in
            row.components(separatedBy: "\t").map { trimmed($0).replacingOccurrences(of: "|", with: "\\|") }
        }
        let columns = cells.map(\.count).max() ?? 0
        func line(_ row: [String]) -> String {
            "| " + (row + Array(repeating: "", count: columns - row.count)).joined(separator: " | ") + " |"
        }
        let separator = "| " + Array(repeating: "---", count: columns).joined(separator: " | ") + " |"
        return ([line(cells[0]), separator] + cells.dropFirst().map(line)).joined(separator: "\n")
    }

    // MARK: - Counts

    /// Words with at least one letter or digit, so bare markup is not counted.
    public static func countWords(_ text: String) -> Int {
        text.split(whereSeparator: { $0.isWhitespace }).filter { word in
            word.unicodeScalars.contains { CharacterSet.letters.contains($0) || CharacterSet.decimalDigits.contains($0) }
        }.count
    }

    /// Characters as a person counts them (an emoji is one).
    public static func countCharacters(_ text: String) -> Int { text.count }

    // MARK: - Format

    /// Tidy spacing without changing what renders (the desktop's Format):
    /// one blank line around headings and code blocks and before a list that
    /// follows a paragraph, `-` for every bullet, `# Title` spacing, no
    /// trailing spaces (a two-space break inside a paragraph stays), no runs
    /// of blank lines. Code blocks and front matter stay byte for byte.
    public static func formatMarkdown(_ text: String) -> String {
        let source = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let endsWithNewline = source.hasSuffix("\n")
        var lines = source.components(separatedBy: "\n")
        if endsWithNewline { lines.removeLast() }
        var out: [String] = []
        func pushBlank() { if let last = out.last, last != "" { out.append("") } }

        var index = 0
        if lines.first == "---", let close = lines.dropFirst().firstIndex(of: "---") {
            out.append(contentsOf: lines[0...close])
            index = close + 1
        }
        var fence: String?
        var inList = false
        var pendingBlankAfter = false
        let hardBreakRE = regex(#"\S {2,}$"#)
        let headingLineRE = regex(#"^(#{1,6})[ \t]+(.*)$"#)
        let bareHeadingRE = regex(#"^#{1,6}$"#)
        let headingStartRE = regex(#"^#{1,6}(\s|$)"#)
        let starBulletRE = regex(#"^(\s*)[*+](\s+)(?=\S)"#)
        while index < lines.count {
            defer { index += 1 }
            let raw = lines[index]
            if let open = fence {
                out.append(raw)
                if let m = match(fenceRE, raw), let marker = m[1], marker.first == open.first, marker.count >= open.count, trimmed(raw) == marker {
                    fence = nil
                    pendingBlankAfter = true
                }
                continue
            }
            if let m = match(fenceRE, raw), let marker = m[1] {
                let nested = inList && (raw.first == " " || raw.first == "\t")
                if !nested {
                    pushBlank()
                    out.append(dropTrailingBlanks(raw))
                    fence = marker
                    pendingBlankAfter = false
                    inList = false
                } else {
                    out.append(raw)
                    fence = marker
                }
                continue
            }
            let next: String? = index + 1 < lines.count ? lines[index + 1] : nil
            let continues = next.map { n in
                !trimmed(n).isEmpty && parseLine(n).kind == nil && !test(headingStartRE, n) && !test(fenceRE, n) && !test(thematicRE, n)
            } ?? false
            let hardBreak = test(hardBreakRE, raw) && continues
            var line: String
            if hardBreak {
                var base = raw
                while base.hasSuffix(" ") { base.removeLast() }
                line = base + "  "
            } else {
                line = dropTrailingBlanks(raw)
            }
            if line.isEmpty {
                pendingBlankAfter = false
                pushBlank()
                continue
            }
            if pendingBlankAfter {
                pushBlank()
                pendingBlankAfter = false
            }
            let heading = match(headingLineRE, line)
            if heading != nil || test(bareHeadingRE, line) {
                if let heading { line = "\(heading[1] ?? "") \(heading[2] ?? "")" }
                pushBlank()
                out.append(line)
                pendingBlankAfter = true
                inList = false
                continue
            }
            if !test(thematicRE, line) {
                let ns = line as NSString
                line = starBulletRE.stringByReplacingMatches(in: line, range: NSRange(location: 0, length: ns.length), withTemplate: "$1-$2")
            }
            let info = parseLine(line)
            let isItem = info.kind == .bullet || info.kind == .task || info.kind == .numbered
            if isItem, !inList, info.indent.isEmpty {
                let ordered = match(orderedRE, line)
                let canInterrupt = ordered == nil || Int(ordered?[2] ?? "") == 1
                if canInterrupt { pushBlank() }
            }
            if isItem {
                inList = true
            } else if !(line.first == " " || line.first == "\t"), out.last == "" {
                inList = false
            }
            out.append(line)
        }
        while out.last == "" { out.removeLast() }
        let result = out.joined(separator: "\n")
        return endsWithNewline && !result.isEmpty ? result + "\n" : result
    }

    // MARK: - Auto-pairs

    private static let pairs: [String: String] = ["(": ")", "[": "]", "`": "`", "*": "*", "_": "_"]

    /// What typing `char` does around the caret: wrap the selection, insert
    /// a pair, step over a closer, or nothing special (nil).
    public static func autoPair(_ state: TextSelection, char typed: String) -> TextSelection? {
        let close = pairs[typed] ?? ((typed == ")" || typed == "]") ? typed : nil)
        guard let close else { return nil }
        let doc = state.doc
        let from = state.from
        let to = state.to
        if insideFence(doc, from) { return nil }
        let nextChar = char(doc, to)
        let prevChar = char(doc, from - 1)
        if from == to, [")", "]", "`", "*", "_"].contains(typed), nextChar == typed {
            return TextSelection(doc: doc, caret: from + 1)
        }
        guard pairs[typed] != nil else { return nil }
        if from != to {
            let selected = slice(doc, from, to)
            if selected.contains("\n"), typed != "`" { return nil }
            return TextSelection(doc: slice(doc, 0, from) + typed + selected + close + slice(doc, to), from: from + 1, to: to + 1)
        }
        if !nextChar.isEmpty, !(isSpace(nextChar) || ")]}.,;:!?".contains(nextChar)) { return nil }
        if typed == "*" || typed == "_" || typed == "`" {
            if trimmed(slice(doc, lineStartAt(doc, from), from)).isEmpty { return nil }
            if prevChar.unicodeScalars.contains(where: { CharacterSet.alphanumerics.contains($0) }) { return nil }
        }
        return TextSelection(doc: slice(doc, 0, from) + typed + close + slice(doc, to), caret: from + 1)
    }

    /// Backspace between an empty pair removes both characters.
    public static func deletePair(_ state: TextSelection) -> TextSelection? {
        let doc = state.doc
        let from = state.from
        guard from == state.to, from > 0 else { return nil }
        let open = char(doc, from - 1)
        if let close = pairs[open], char(doc, from) == close {
            return TextSelection(doc: slice(doc, 0, from - 1) + slice(doc, from + 1), caret: from - 1)
        }
        return nil
    }

    /// Toggle the task box `[ ]` / `[x]` on the line holding `pos`.
    public static func toggleTask(_ doc: String, at pos: Int) -> String? {
        let start = lineStartAt(doc, pos)
        let end = lineEndAt(doc, pos)
        let line = slice(doc, start, end)
        guard let m = match(taskRE, line) else { return nil }
        let boxAt = start + len(m[1] ?? "") + len(m[2] ?? "") + len(m[3] ?? "") + 1
        let checked = m[4] != " "
        return slice(doc, 0, boxAt) + (checked ? " " : "x") + slice(doc, boxAt + 1)
    }

    /// The smallest single replacement turning `before` into `after`, in
    /// UTF-16 offsets: the text view replaces only that, so undo and the
    /// caret behave as if the person typed it.
    public static func minimalChange(_ before: String, _ after: String) -> (from: Int, to: Int, insert: String) {
        let a = Array(before.utf16)
        let b = Array(after.utf16)
        var start = 0
        let limit = min(a.count, b.count)
        while start < limit, a[start] == b[start] { start += 1 }
        var endA = a.count
        var endB = b.count
        while endA > start, endB > start, a[endA - 1] == b[endB - 1] {
            endA -= 1
            endB -= 1
        }
        // never split a surrogate pair
        while start > 0, (start < a.count && UTF16.isTrailSurrogate(a[start])) || (start < b.count && UTF16.isTrailSurrogate(b[start])) { start -= 1 }
        while endA < a.count, UTF16.isTrailSurrogate(a[endA]) { endA += 1; endB += 1 }
        let insert = String(decoding: b[start..<endB], as: UTF16.self)
        return (start, endA, insert)
    }
}

