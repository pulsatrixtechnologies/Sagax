// One table view for every tabular thing in a message (`RichTable.tsx`):
// GFM tables, whose cells keep their inline Markdown, and ```csv / ```tsv
// fences. The grid keeps the phone's look (reference 02): widest-cell
// columns, a rule under the header, horizontal scroll inside the bubble.
// The desktop's toolbar is the long-press menu: Copy as CSV, Copy as
// Markdown (the rows as currently shown), Sort by a column (ascending,
// descending, off) and, past eight rows, Filter rows. Numeric columns with
// no written alignment sit right, as on the desktop.
import SwiftUI
import UIKit
import CompanionCore

struct RichTableView: View {
    @Environment(\.themePalette) var themePalette
    let table: MarkdownTable
    /// Streaming caret on the last cell.
    var tail = false
    /// The settled bubble's `message-<id>-scroll` id (first table only).
    var scrollIdentifier: String?
    /// CSV cells are data, drawn as written rather than as Markdown.
    var literal = false
    var identifier: String?
    let inline: (String, Bool) -> Text
    let plain: (String) -> String

    @State private var sort: RichSort?
    @State private var query = ""
    @State private var filtering = false
    @State private var draftQuery = ""
    @StateObject private var feedback = RichCopyFeedback()

    /// Tables with more rows than this offer a filter (`FILTER_THRESHOLD`).
    static let filterThreshold = 8

    private var texts: [[String]] { table.rows.map { $0.map(cellText) } }
    private var headerTexts: [String] { table.headers.map(cellText) }
    private var numeric: [Bool] { RichBlocks.numericColumns(texts, width: table.headers.count) }
    private var order: [Int] { RichBlocks.visibleRowOrder(texts, query: query, sort: sort, numeric: numeric) }

    private func cellText(_ value: String) -> String {
        literal ? value : plain(value).trimmingCharacters(in: .whitespaces)
    }

    private func alignment(_ column: Int) -> MarkdownTableAlignment {
        let written = column < table.alignments.count ? table.alignments[column] : .leading
        if table.isDeclared(column) { return written }
        // a table built without delimiter knowledge: any non-default was written
        if table.declared.isEmpty && written != .leading { return written }
        return column < numeric.count && numeric[column] ? .trailing : written
    }

    private var exportAlign: [RichColumnAlign?] {
        table.headers.indices.map { column in
            guard table.isDeclared(column) else { return nil }
            switch table.alignments[column] {
            case .leading: return .left
            case .trailing: return .right
            case .center: return .center
            }
        }
    }

    var body: some View {
        let order = self.order
        VStack(alignment: .leading, spacing: 4) {
            if !query.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "line.3.horizontal.decrease")
                    Text("\(order.count) of \(table.rows.count) rows")
                        .monospacedDigit()
                    Text(verbatim: "“\(query)”").lineLimit(1)
                    Spacer(minLength: 4)
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Clear filter"))
                    .accessibilityIdentifier(identifier.map { "\($0)-clear-filter" } ?? "table-clear-filter")
                }
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier(identifier.map { "\($0)-filtered" } ?? "table-filtered")
            }
            grid(order)
            if order.isEmpty && !table.rows.isEmpty {
                Text("No rows match the filter.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .overlay(alignment: .topTrailing) {
            RichCopiedBadge(feedback: feedback, identifier: identifier.map { "\($0)-copied" } ?? "table-copied")
        }
        .contentShape(.contextMenuPreview, Rectangle())
        .contextMenu { menu(order) }
        .alert("Filter rows", isPresented: $filtering) {
            TextField("Filter rows", text: $draftQuery)
                .accessibilityIdentifier("table-filter-field")
            Button("Cancel", role: .cancel) {}
            Button("Filter") { query = draftQuery }
        }
        .accessibilityElement(children: .contain)
        .modifier(RichIdentifier(identifier: identifier))
    }

    @ViewBuilder
    private func menu(_ order: [Int]) -> some View {
        let shown = order.map { texts[$0] }
        Button {
            feedback.copy("csv", RichBlocks.tableToCSV(header: headerTexts, rows: shown))
        } label: {
            Label("Copy as CSV", systemImage: "tablecells")
        }
        Button {
            feedback.copy("md", RichBlocks.tableToMarkdown(header: headerTexts, rows: shown, align: exportAlign))
        } label: {
            Label("Copy as Markdown", systemImage: "doc.plaintext")
        }
        if !table.rows.isEmpty {
            // one item per column (the desktop's header buttons): ascending,
            // descending, then off
            ForEach(Array(headerTexts.enumerated()), id: \.offset) { column, name in
                let label = name.isEmpty ? String(column + 1) : name
                Button {
                    sort = RichBlocks.nextSort(sort, column: column)
                } label: {
                    Label(
                        String(localized: "Sort by \(label)"),
                        systemImage: sort?.column == column ? (sort?.direction == .asc ? "arrow.up" : "arrow.down") : "arrow.up.arrow.down"
                    )
                }
            }
        }
        if table.rows.count > Self.filterThreshold {
            Button {
                draftQuery = query
                filtering = true
            } label: {
                Label("Filter rows", systemImage: "line.3.horizontal.decrease")
            }
        }
    }

    private func grid(_ order: [Int]) -> some View {
        let widths = columnWidths()
        return ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                GridRow {
                    ForEach(Array(table.headers.enumerated()), id: \.offset) { index, header in
                        cell(
                            header,
                            width: widths[index],
                            alignment: alignment(index),
                            weight: .semibold,
                            tail: tail && table.rows.isEmpty && index == table.headers.count - 1,
                            sorted: sort?.column == index ? sort?.direction : nil,
                            identifier: scrollIdentifier.map { "\($0)-cell-0-\(index)" }
                        )
                    }
                }
                if !table.headers.isEmpty {
                    Divider().gridCellColumns(table.headers.count)
                }
                ForEach(Array(order.enumerated()), id: \.element) { position, rowIndex in
                    let row = table.rows[rowIndex]
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { index, value in
                            let isLast = position == order.count - 1 && index == row.count - 1
                            cell(
                                value,
                                width: widths[min(index, widths.count - 1)],
                                alignment: alignment(index),
                                weight: .regular,
                                tail: tail && isLast,
                                sorted: nil,
                                identifier: scrollIdentifier.map { "\($0)-cell-\(position + 1)-\(index)" }
                            )
                        }
                    }
                }
            }
            .padding(.vertical, 4)
        }
        .background(alignment: .topLeading) {
            if let scrollIdentifier {
                Color.white.opacity(0.001)
                    .frame(width: 12, height: 12)
                    .accessibilityIdentifier(scrollIdentifier)
            }
        }
    }

    private func render(_ text: String, tail: Bool) -> Text {
        literal ? Text(verbatim: text) + (tail ? inline("", true) : Text("")) : inline(text, tail)
    }

    private func cell(
        _ text: String,
        width: CGFloat,
        alignment: MarkdownTableAlignment,
        weight: Font.Weight,
        tail: Bool,
        sorted: RichSort.Direction?,
        identifier: String?
    ) -> some View {
        Color.clear
            .frame(width: (tail ? width + caretWidth : width) + (sorted == nil ? 0 : 14), height: 22)
            .overlay(alignment: frameAlignment(alignment)) {
                HStack(spacing: 3) {
                    render(text, tail: tail)
                        .font(.system(size: 15, weight: weight))
                        .lineLimit(1)
                    if let sorted {
                        Image(systemName: sorted == .asc ? "arrow.up" : "arrow.down")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                    }
                }
                .accessibilityHidden(true)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(literal ? text : plain(text))
            .modifier(RichIdentifier(identifier: identifier))
    }

    private func frameAlignment(_ alignment: MarkdownTableAlignment) -> Alignment {
        switch alignment {
        case .leading: .leading
        case .trailing: .trailing
        case .center: .center
        }
    }

    /// Column width is the widest single-line cell, measured on the words
    /// that are actually drawn. A code span is also measured in monospace.
    private func columnWidths() -> [CGFloat] {
        let headerFont = UIFont.systemFont(ofSize: 15, weight: .semibold)
        let bodyFont = UIFont.systemFont(ofSize: 15, weight: .regular)
        return table.headers.indices.map { index in
            var widest = textWidth(table.headers[index], font: headerFont)
            for row in table.rows where index < row.count {
                widest = max(widest, textWidth(row[index], font: bodyFont))
            }
            return max(widest + 8, 24)
        }
    }

    private var caretWidth: CGFloat {
        ceil(("\u{2007}▍" as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: 15)]).width)
    }

    private func textWidth(_ text: String, font: UIFont) -> CGFloat {
        let shown = literal ? text : plain(text)
        var width = ceil((shown as NSString).size(withAttributes: [.font: font]).width)
        if !literal, text.contains("`") {
            let mono = UIFont.monospacedSystemFont(ofSize: font.pointSize, weight: .regular)
            width = max(width, ceil((shown as NSString).size(withAttributes: [.font: mono]).width))
        }
        return width
    }
}

extension MarkdownTable {
    /// A ```csv / ```tsv fence as a table (first row is the header), padded
    /// to the widest row (`tableModelFromDelimited`).
    static func delimited(_ code: String, language: String) -> MarkdownTable? {
        let lang = language.trimmingCharacters(in: .whitespaces).lowercased()
        let parsed = RichBlocks.parseDelimited(code, delimiter: lang == "tsv" ? "\t" : nil)
        guard let head = parsed.first else { return nil }
        let width = parsed.map(\.count).max() ?? 0
        func pad(_ row: [String]) -> [String] { (0..<width).map { $0 < row.count ? row[$0] : "" } }
        guard width > 0 else { return nil }
        return MarkdownTable(
            headers: pad(head),
            alignments: Array(repeating: .leading, count: width),
            rows: parsed.dropFirst().map(pad),
            declared: Array(repeating: false, count: width)
        )
    }
}
