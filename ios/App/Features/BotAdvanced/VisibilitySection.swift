// Who can see it (BA14, bot-settings/VisibilitySection.tsx): everyone who
// can sign in, admins only, or the listed addresses plus admins. Shown to an
// admin of a served workspace that is not an organization server (the
// grants replace it there). Saving is the change; no confirmation step.
import CompanionCore
import SwiftUI

struct BotVisibilitySection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var mode: VisibilityMode = .everyone
    @State private var people = ""
    @State private var busy = false
    @State private var saved = false
    @State private var error: String?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var dirty: Bool { VisibilityRules.dirty(mode: mode, people: people, saved: current.visibility) }
    private var storedKey: String { VisibilityRules.key(current.visibility) }

    var body: some View {
        Section {
            Picker(String(localized: "Who can see it"), selection: $mode) {
                Text(String(localized: "Everyone who can sign in")).tag(VisibilityMode.everyone)
                Text(String(localized: "Admins only")).tag(VisibilityMode.admins)
                Text(String(localized: "Only these people")).tag(VisibilityMode.people)
            }
            .pickerStyle(.inline)
            .labelsHidden()
            .disabled(busy)
            .accessibilityIdentifier("visibility-mode")
            .onValueChange(of: mode) { _ in saved = false; error = nil }
        } header: {
            Text(String(localized: "Who can see it"))
        } footer: {
            Text(String(localized: "Choose who sees this bot, its conversations, the rooms it is in and its files. Admins always can."))
        }
        .task(id: "\(bot.id)|\(storedKey)") {
            // the stored value changed (another admin, or this save echoed back)
            let form = VisibilityRules.form(current.visibility)
            mode = form.mode
            people = form.people
        }

        if mode == .people {
            Section {
                TextEditor(text: $people)
                    .font(.system(size: 13, design: .monospaced))
                    .frame(minHeight: 100)
                    .scrollContentBackground(.hidden)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .disabled(busy)
                    .overlay(alignment: .topLeading) {
                        if people.isEmpty {
                            Text(String(localized: "One email or @company.com per line"))
                                .font(.system(size: 13, design: .monospaced))
                                .foregroundStyle(Theme.placeholder)
                                .padding(.top, 8).padding(.leading, 5)
                                .allowsHitTesting(false)
                        }
                    }
                    .accessibilityIdentifier("visibility-people")
                    .onValueChange(of: people) { _ in saved = false }
            } header: {
                Text(String(localized: "Email addresses"))
            }
        }

        Section {
            let mixed = VisibilityRules.mixedRooms(current, rooms: session.state.rooms, bots: session.state.bots)
            if !mixed.isEmpty {
                Text(String(localized: "These rooms are visible to fewer people than this bot: \(mixed.map { "\"\($0.name)\"" }.joined(separator: ", ")). A room keeps the narrowest audience it has ever had, so taking a bot out or widening one never shows its transcript to more people, and such a room stays out of this bot's recall. When the room's bots are right, widen it here."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                ForEach(mixed) { room in
                    Button(String(localized: "Show \"\(room.name)\" to everyone its bots allow")) { Task { await resetRoom(room) } }
                        .disabled(busy)
                }
            }
            Button {
                Task { await save() }
            } label: {
                HStack {
                    Text(busy ? String(localized: "Saving…") : String(localized: "Save"))
                    if busy { Spacer(); ProgressView() }
                }
            }
            .disabled(busy || !dirty)
            .accessibilityIdentifier("visibility-save")
            if saved, !dirty {
                Label(String(localized: "Saved. It applies at once."), systemImage: "checkmark")
                    .font(.footnote)
                    .foregroundStyle(Theme.success)
                    .accessibilityIdentifier("visibility-saved")
            }
            if let error {
                Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
            }
        } footer: {
            Text(String(localized: "A room shows only to people who can see every bot in it, and this bot works only with teammates exactly the same people can see."))
        }
    }

    private func save() async {
        guard let value = VisibilityRules.value(mode: mode, people: people) else {
            error = String(localized: "Add at least one email address, or choose Admins only.")
            return
        }
        guard let client = session.profileClient else { return }
        busy = true
        error = nil
        saved = false
        defer { busy = false }
        do {
            let updated = try await client.setVisibility(botId: bot.id, visibility: value)
            session.applyProfileBot(updated)
            saved = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func resetRoom(_ room: Room) async {
        guard let client = session.profileClient else { return }
        busy = true
        error = nil
        defer { busy = false }
        do { try await client.resetRoomAudience(groupId: room.id) } catch { self.error = error.localizedDescription }
    }
}

struct BotVisibilityPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    var body: some View {
        ThemedForm { BotVisibilitySection(bot: bot) }
            .navigationTitle(String(localized: "Who can see it"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("visibility-page")
    }
}
