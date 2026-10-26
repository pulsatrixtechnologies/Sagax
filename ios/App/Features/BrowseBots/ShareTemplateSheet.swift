// "Share as Template" from the bot's menu (TemplateLinkSection.tsx): the
// bot's name and description frozen as a template behind a public link.
// Create copies the new link; each link can be copied, opened, updated
// under the same address, or turned off (immediate and final).
import CompanionCore
import SwiftUI
import UIKit

struct ShareTemplateSheet: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var description: String
    @State private var links: [TemplateLink]?
    @State private var busy = false
    @State private var copied: String?
    @State private var updated: String?
    @State private var error: String?
    @State private var viewing: URL?

    init(bot: Bot) {
        _name = State(initialValue: bot.name)
        _description = State(initialValue: bot.displayRole)
    }

    private var linkBody: TemplateLinkBody { TemplateLinkBody(name: name, description: description) }

    var body: some View {
        NavigationStack {
            ThemedForm {
                Section {
                    TextField("Name", text: $name)
                        .accessibilityIdentifier("share-template.name")
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(1...4)
                        .accessibilityIdentifier("share-template.description")
                }
                Section {
                    Button {
                        Task { await create() }
                    } label: {
                        HStack(spacing: 8) {
                            if busy { ProgressView().controlSize(.small) } else { Image(systemName: "link") }
                            Text("Create a public link")
                        }
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("share-template.create")
                    ForEach(links ?? []) { link in row(link) }
                } header: {
                    Text("Share the link")
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Anyone with the link sees a read-only card of this template and can import it into Sagax. Starter notes never go into a link.")
                        Text("Never in a link: starter notes, connected apps, keys and model choices. Turning a link off is immediate.")
                        if let error {
                            Text(verbatim: error).foregroundStyle(Theme.danger)
                        }
                    }
                }
            }
            .navigationTitle(String(localized: "Share as Template"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) { dismiss() }
                }
            }
            .task { await load() }
            .sheet(item: Binding(get: { viewing.map(IdentifiedURL.init) }, set: { viewing = $0?.url })) { item in
                SafariSheet(url: item.url).ignoresSafeArea()
            }
        }
        .accessibilityIdentifier("share-template")
    }

    @ViewBuilder
    private func row(_ link: TemplateLink) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(verbatim: link.url)
                    .font(.footnote)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    UIPasteboard.general.string = link.url
                    copied = link.id
                    Haptics.selection()
                } label: {
                    Image(systemName: copied == link.id ? "checkmark" : "doc.on.doc")
                        .foregroundStyle(copied == link.id ? Theme.success : Theme.textSecondary)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(Text("Copy the link"))
                Button {
                    viewing = URL(string: link.url)
                } label: {
                    Image(systemName: "arrow.up.forward.square").foregroundStyle(Theme.textSecondary)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(Text("View the shared copy"))
            }
            Text(verbatim: stamp(link))
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
            HStack(spacing: 16) {
                Button {
                    Task { await update(link) }
                } label: {
                    Label("Update the template", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .disabled(busy)
                Button(role: .destructive) {
                    Task { await revoke(link) }
                } label: {
                    Label("Turn off the public link", systemImage: "xmark.circle")
                }
                .buttonStyle(.borderless)
                .disabled(busy)
            }
            .font(.footnote)
            if updated == link.id {
                Text("Template updated. The link now opens this version.")
                    .font(.footnote)
                    .foregroundStyle(Theme.success)
            }
            if !link.reachable {
                Text("This address works on this computer only. Share the link from your organization server, or set a public address, for others to open it.")
                    .font(.footnote)
                    .foregroundStyle(Theme.warning)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("share-template.link")
    }

    private func stamp(_ link: TemplateLink) -> String {
        let at = Date(timeIntervalSince1970: (link.updatedAt ?? link.createdAt) / 1_000)
        var line = "\(link.name) · \(at.formatted(date: .abbreviated, time: .shortened))"
        if link.updatedAt != nil { line += " · " + String(localized: "updated") }
        return line
    }

    private func load() async {
        guard let client = session.settingsClient else { links = []; return }
        links = (try? await client.templateLinks()) ?? []
    }

    private func create() async {
        guard let client = session.settingsClient else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let link = try await client.createTemplateLink(linkBody)
            links = (links ?? []) + [link]
            UIPasteboard.general.string = link.url
            copied = link.id
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func update(_ link: TemplateLink) async {
        guard let client = session.settingsClient else { return }
        busy = true
        error = nil
        updated = nil
        defer { busy = false }
        do {
            let fresh = try await client.updateTemplateLink(id: link.id, linkBody)
            links = (links ?? []).map { $0.id == link.id ? fresh : $0 }
            updated = link.id
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func revoke(_ link: TemplateLink) async {
        guard let client = session.settingsClient else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await client.revokeTemplateLink(id: link.id)
            links = (links ?? []).filter { $0.id != link.id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
