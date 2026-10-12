// ConnectWise records in the conversation. A change asks Sagax for an
// approval card. The view never calls ConnectWise.
import SwiftUI
import CompanionCore

struct CwWidgetCard: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    let widget: CwWidget
    var threadId: String?
    var botId: String?
    var ask: ((CwActionBody) -> Void)?
    @State private var openId: Int?

    var body: some View {
        if widget.isKnown {
            VStack(alignment: .leading, spacing: 0) {
                header
                if widget.view == "card", let record = widget.records.first {
                    recordBody(record).padding(12)
                    CwRecordActions(family: widget.family, record: record, threadId: threadId, ask: ask)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 12)
                } else {
                    list
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.card))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2).fill(rail).frame(width: 4)
            }
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hairline.opacity(0.45), lineWidth: 0.5))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("cw-widget-\(widget.family)")
        }
    }

    private var rail: Color {
        switch widget.family {
        case "time": return Theme.warning
        case "schedule": return Theme.success
        case "company": return Theme.danger
        default: return Theme.accent
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.cardRaised))
            VStack(alignment: .leading, spacing: 1) {
                Text("ConnectWise")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Theme.textSecondary)
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            if let url = openTarget {
                Button { openURL(url) } label: {
                    Label("Open", systemImage: "arrow.up.right")
                        .font(.system(size: 12, weight: .medium))
                        .padding(.horizontal, 10)
                        .frame(minHeight: 32)
                        .background(Capsule().fill(Theme.cardRaised))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("cw-open")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.cardRaised.opacity(0.45))
    }

    private var title: String {
        if widget.view == "card", let record = widget.records.first {
            return record.summary ?? record.name ?? record.charge ?? record.company ?? "#\(record.id)"
        }
        switch widget.family {
        case "time": return "Time"
        case "schedule": return "Schedule"
        case "agreement": return "Agreements"
        case "company": return "Companies"
        default: return "Tickets"
        }
    }

    private var symbol: String {
        switch widget.family {
        case "time": return "clock"
        case "schedule": return "calendar"
        case "agreement": return "doc.text"
        case "company": return "building.2"
        default: return "ticket"
        }
    }

    private var openTarget: URL? {
        guard widget.view == "card", let link = widget.records.first?.link, let url = URL(string: link) else { return nil }
        return url
    }

    private var list: some View {
        VStack(spacing: 0) {
            ForEach(widget.records.prefix(8), id: \.id) { record in
                Button {
                    openId = openId == record.id ? nil : record.id
                } label: {
                    HStack(alignment: .firstTextBaseline) {
                        Text(record.summary ?? record.name ?? record.charge ?? record.company ?? "#\(record.id)")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        if let status = record.status ?? record.billable {
                            Text(status).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                if openId == record.id {
                    recordBody(record).padding(.horizontal, 12)
                    CwRecordActions(family: widget.family, record: record, threadId: threadId, ask: ask)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 10)
                }
                Divider().overlay(Theme.hairline.opacity(0.3))
            }
        }
    }

    @ViewBuilder
    private func recordBody(_ record: CwRecordView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let status = record.status {
                Text(status)
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Theme.accent.opacity(0.16)))
                    .foregroundStyle(Theme.accentText)
            }
            meta(record)
            if let notes = record.notes, !notes.isEmpty {
                Text(notes).font(.system(size: 13)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func meta(_ record: CwRecordView) -> some View {
        let rows: [(String, String)] = [
            ("Company", record.company),
            ("Member", record.member),
            ("Owner", record.owner),
            ("Where", record.place),
            ("Phone", record.phone),
            ("City", record.city),
            ("Hours", hours(record)),
            ("Amount", record.billAmount.map { String(format: "%.0f", $0) }),
        ].compactMap { label, value in value.map { (label, $0) } }
        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 8) {
            ForEach(rows, id: \.0) { row in
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.0).font(.system(size: 10, weight: .medium)).foregroundStyle(Theme.textSecondary)
                    Text(row.1).font(.system(size: 13)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                }
            }
        }
    }

    private func hours(_ record: CwRecordView) -> String? {
        let value = record.hours ?? record.actualHours
        guard let value else { return nil }
        return String(format: "%.2f h", value)
    }

}

/// One record's write controls. Each row keeps its own draft, and every
/// change is handed to Sagax as an approval request.
private struct CwRecordActions: View {
    let family: String
    let record: CwRecordView
    var threadId: String?
    var ask: ((CwActionBody) -> Void)?
    @State private var status = ""
    @State private var note = ""
    @State private var internalNote = true
    @State private var asked = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch family {
            case "ticket":
                HStack {
                    TextField("New status", text: $status)
                        .textFieldStyle(.roundedBorder)
                    actionButton("Update status") {
                        let trimmed = status.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return }
                        submit(CwActionBody.ticketStatus(ticketId: record.id, status: trimmed, from: record.status))
                    }
                }
                TextField("What should the note say?", text: $note, axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Button(internalNote ? "Internal" : "Discussion") { internalNote.toggle() }
                        .font(.system(size: 12, weight: .medium))
                    actionButton("Add a note") {
                        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return }
                        submit(CwActionBody.ticketNote(ticketId: record.id, text: trimmed, internalNote: internalNote))
                    }
                }
            case "time":
                HStack {
                    ForEach(["Billable", "DoNotBill", "NoCharge"], id: \.self) { option in
                        actionButton(option == "DoNotBill" ? "Do not bill" : option == "NoCharge" ? "No charge" : "Billable") {
                            submit(CwActionBody.timeBillable(entryId: record.id, billable: option, from: record.billable))
                        }
                        .disabled(record.billable == option)
                    }
                }
            case "schedule":
                actionButton(record.done == true ? "Reopen" : "Mark done") {
                    submit(CwActionBody.scheduleDone(entryId: record.id, done: record.done != true))
                }
            case "company":
                TextField("What should the note say?", text: $note, axis: .vertical)
                    .lineLimit(2...4)
                    .textFieldStyle(.roundedBorder)
                actionButton("Add a note") {
                    let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !trimmed.isEmpty else { return }
                    submit(CwActionBody.companyNote(companyId: record.id, text: trimmed))
                }
            default:
                EmptyView()
            }
            askedLine
        }
    }

    private func actionButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(Capsule().fill(Theme.accent))
            .foregroundStyle(Theme.accentInk)
            .buttonStyle(.plain)
            .disabled(ask == nil || threadId == nil)
    }

    @ViewBuilder
    private var askedLine: some View {
        if family == "agreement" {
            EmptyView()
        } else if ask == nil || threadId == nil {
            Text("Open this in a conversation to ask for a change")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
        } else if asked {
            Text("Waiting for approval")
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
        }
    }

    private func submit(_ action: CwActionBody) {
        guard let ask, threadId != nil else { return }
        asked = true
        ask(action)
    }
}
