// The card a phone tool request shows on this iPhone: which bot, what it
// wants to read or change, why (the bot's own words), and the approval
// card's three choices: Refuser / Toujours permettre / Permettre une fois.
// Toujours permettre is absent where it never applies (a shortcut, the
// clipboard, photos). Photos: Permettre une fois opens the picker; what the
// person picks is the answer.
import CompanionCore
import PhotosUI
import SwiftUI
import UIKit

struct PhoneToolCard: View {
    let request: PhoneToolRequest
    @State private var picking = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: PhoneToolWords.symbol(request.tool))
                    .font(.title2)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.accentColor.opacity(0.15)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: request.botName.isEmpty ? String(localized: "A bot") : request.botName)
                        .font(.headline)
                    Text("Wants to use a tool on your phone")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            Text(PhoneToolWords.what(request))
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
            if let reason = request.reason {
                Text(verbatim: "« \(reason) »")
                    .font(.callout)
                    .italic()
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if request.writes {
                Label("This changes something on your phone.", systemImage: "square.and.pencil")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            VStack(spacing: 10) {
                ForEach(PhoneToolRules.choices(for: request), id: \.rawValue) { choice in
                    button(choice)
                }
            }
            .disabled(working)
        }
        .padding(20)
        .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: max(1, min(request.int("max") ?? 1, 3)), matching: .images)
        .onValueChange(of: picking) { open in
            // closed without a pick: nothing goes, the card stays
            if !open && picked.isEmpty { working = false }
        }
        .onValueChange(of: picked) { items in
            guard !items.isEmpty else { return }
            working = true
            Task {
                let jpegs = await PhoneToolPhotos.jpegs(items)
                await PhoneToolCenter.shared.choose(.once, photos: jpegs)
            }
        }
    }

    @ViewBuilder
    private func button(_ choice: PhoneToolRules.Choice) -> some View {
        switch choice {
        case .deny:
            Button(role: .cancel) { answer(.deny) } label: {
                Text("Deny").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        case .always:
            Button { answer(.always) } label: {
                Text("Always allow").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        case .once:
            Button { request.tool == .photos ? (picking = true) : answer(.once) } label: {
                Text(request.tool == .photos ? "Choose photos" : "Allow once").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }

    private func answer(_ choice: PhoneToolRules.Choice) {
        working = true
        Task { await PhoneToolCenter.shared.choose(choice) }
    }
}

/// The words of each tool, in the phone's language.
enum PhoneToolWords {
    static func symbol(_ tool: PhoneTool?) -> String {
        switch tool {
        case .location: "location.fill"
        case .contacts: "person.crop.circle"
        case .reminders: "checklist"
        case .calendar: "calendar"
        case .photos: "photo.on.rectangle"
        case .shortcut: "square.stack.3d.up"
        case .clipboard: "doc.on.clipboard"
        case .status: "battery.75percent"
        case nil: "questionmark.circle"
        }
    }

    static func name(_ tool: PhoneTool) -> String {
        switch tool {
        case .location: String(localized: "Location")
        case .contacts: String(localized: "Contacts")
        case .reminders: String(localized: "Reminders")
        case .calendar: String(localized: "Calendar")
        case .photos: String(localized: "Photos")
        case .shortcut: String(localized: "Shortcuts")
        case .clipboard: String(localized: "Clipboard")
        case .status: String(localized: "Battery, network and Focus")
        }
    }

    static func what(_ request: PhoneToolRequest) -> String {
        switch request.tool {
        case .location:
            return request.flag("precise") ? String(localized: "Your exact position, once.") : String(localized: "Your approximate position (about 100 m), once.")
        case .contacts:
            let query = request.string("query") ?? ""
            let fields = PhoneToolShaping.contactFields.filter(PhoneToolShaping.requestedFields(request).contains).map(field).joined(separator: ", ")
            return String(localized: "Search “\(query)” in your contacts and send: \(fields).")
        case .reminders:
            if request.action == "create" { return String(localized: "Add the reminder “\(request.string("title") ?? "")”.") }
            return String(localized: "Read your reminders that are not done.")
        case .calendar:
            if request.action == "create" {
                let start = PhoneToolShaping.date(request.string("start")).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? ""
                return String(localized: "Add “\(request.string("title") ?? "")” to your calendar, \(start).")
            }
            let from = PhoneToolShaping.date(request.string("from")).map { $0.formatted(date: .abbreviated, time: .omitted) } ?? ""
            let to = PhoneToolShaping.date(request.string("to")).map { $0.formatted(date: .abbreviated, time: .omitted) } ?? ""
            return String(localized: "Read your calendar from \(from) to \(to).")
        case .photos:
            return String(localized: "Pick up to \(max(1, min(request.int("max") ?? 1, 3))) photos to send.")
        case .shortcut:
            return String(localized: "Run your shortcut “\(request.string("name") ?? "")”.")
        case .clipboard:
            return String(localized: "Read the text on your clipboard.")
        case .status:
            return String(localized: "Read the battery, the network and whether a Focus is on.")
        case nil:
            return String(localized: "This version of Sagax does not know this tool. Update the app to use it.")
        }
    }

    private static func field(_ name: String) -> String {
        switch name {
        case "phone": String(localized: "phone")
        case "email": String(localized: "email")
        case "address": String(localized: "address")
        case "birthday": String(localized: "birthday")
        default: String(localized: "organization")
        }
    }
}

/// Picked photos, downscaled to PhoneToolShaping.photoMaxSide and JPEG.
enum PhoneToolPhotos {
    static func jpegs(_ items: [PhotosPickerItem]) async -> [Data] {
        var out: [Data] = []
        for item in items.prefix(3) {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else { continue }
            let size = PhoneToolShaping.scaledSize(width: image.size.width, height: image.size.height)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let scaled = UIGraphicsImageRenderer(size: CGSize(width: size.width, height: size.height), format: format).image { _ in
                image.draw(in: CGRect(x: 0, y: 0, width: size.width, height: size.height))
            }
            if let jpeg = scaled.jpegData(compressionQuality: 0.7) { out.append(jpeg) }
        }
        return out
    }
}
