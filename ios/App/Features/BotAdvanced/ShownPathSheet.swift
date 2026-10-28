// The person shows a path once, re-reads it, then saves it as a skill or
// refuses. An existing skill is replaced only if they agree. Uploaded
// skills are not part of this sheet.
import CompanionCore
import SwiftUI

struct ShownPathSheet: View {
    let botId: String
    let client: CompanionClient
    var onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var detail = ""
    @State private var lines = ""
    @State private var preview = ""
    @State private var exists = false
    @State private var message = ""
    @State private var working = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(String(localized: "Name"), text: $title)
                    TextField(String(localized: "What it is for"), text: $detail)
                    TextField(String(localized: "One step per line"), text: $lines, axis: .vertical)
                        .lineLimit(4...12)
                } footer: {
                    Text(String(localized: "Show the path once. Read it back, then save it as a skill or refuse. Other skills stay."))
                }
                if !preview.isEmpty {
                    Section(String(localized: "Read it back")) {
                        Text(verbatim: preview).font(.footnote)
                    }
                }
                if exists {
                    Section {
                        Button(String(localized: "Replace this skill")) { Task { await save(replace: true) } }
                            .disabled(working)
                    } footer: {
                        Text(String(localized: "This bot already has a skill with this name. Replace it only if you agree. The other skills stay."))
                    }
                }
                if !message.isEmpty {
                    Text(verbatim: message).font(.footnote)
                }
            }
            .navigationTitle(String(localized: "Show a path"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Refuse")) { Task { await refuse() } }.disabled(working)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Review")) { Task { await review() } }.disabled(working)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(String(localized: "Save")) { Task { await save(replace: false) } }.disabled(working)
                }
            }
        }
    }

    private var stepLines: [String] {
        lines.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    private func review() async {
        working = true
        message = ""
        defer { working = false }
        do {
            let answer = try await client.postShownPath(botId: botId, mode: "preview", title: title, detail: detail, lines: stepLines, replace: false)
            preview = answer.markdown ?? ""
            exists = answer.exists == true
        } catch {
            message = error.localizedDescription
        }
    }

    private func save(replace: Bool) async {
        working = true
        message = ""
        defer { working = false }
        do {
            let answer = try await client.postShownPath(botId: botId, mode: "save", title: title, detail: detail, lines: stepLines, replace: replace)
            if answer.code == "exists" {
                exists = true
                message = String(localized: "This bot already has this skill. Replace it only if you agree.")
                return
            }
            onSaved()
            dismiss()
        } catch {
            message = error.localizedDescription
        }
    }

    private func refuse() async {
        working = true
        defer { working = false }
        _ = try? await client.postShownPath(botId: botId, mode: "refuse", title: title, detail: detail, lines: stepLines, replace: false)
        dismiss()
    }
}
