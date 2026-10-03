// The Room info pages behind the Instructions and Memory rows (matrix RM7,
// RM8, RM17 bulletin): GroupPanel.tsx's Instructions tab and
// GroupMemoryTab.tsx. The instructions are the owner's to edit and everyone
// else's to read; the memory's editor is the server's call (`canEdit`).
import CompanionCore
import SwiftUI

struct RoomInstructionsView: View {
    @Environment(\.themePalette) var themePalette
    let roomId: String
    let editable: Bool
    @EnvironmentObject private var session: Session
    @State private var draft: String?
    @State private var saving = false

    private var room: Room? { session.state.rooms.first { $0.id == roomId } }
    private var bulletin: String { room?.bulletin ?? "" }
    private var dirty: Bool { draft.map { $0 != bulletin } ?? false }

    var body: some View {
        ThemedList {
            Section {
                if editable {
                    TextEditor(text: Binding(get: { draft ?? bulletin }, set: { draft = $0 }))
                        .frame(minHeight: 220)
                        .scrollContentBackground(.hidden)
                        .overlay(alignment: .topLeading) {
                            if (draft ?? bulletin).isEmpty {
                                Text(String(localized: "Goals, tone, ownership, constraints…"))
                                    .foregroundStyle(Theme.placeholder)
                                    .padding(.top, 8)
                                    .padding(.leading, 5)
                                    .allowsHitTesting(false)
                            }
                        }
                        .accessibilityIdentifier("room-instructions-editor")
                } else if bulletin.isEmpty {
                    Text(String(localized: "No group instructions yet."))
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("room-instructions-text")
                } else {
                    Text(verbatim: bulletin)
                        .textSelection(.enabled)
                        .foregroundStyle(Theme.textPrimary)
                        .accessibilityIdentifier("room-instructions-text")
                }
            } header: {
                Text(String(localized: "Group instructions"))
            } footer: {
                Text(String(localized: "A shared brief every member sees on each turn. You can edit it later."))
            }
        }
        .navigationTitle(String(localized: "Instructions"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if editable {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Save")) { save() }
                        .disabled(!dirty || saving)
                        .accessibilityIdentifier("room-instructions-save")
                }
            }
        }
        // The desktop saves when the field loses focus: leaving the page
        // is that here.
        .onDisappear { save() }
    }

    private func save() {
        guard editable, dirty, let room, let text = draft else { return }
        saving = true
        Task {
            if await session.patchRoom(room, RoomPatch(bulletin: text)) { draft = nil }
            saving = false
        }
    }
}

struct RoomMemoryView: View {
    @Environment(\.themePalette) var themePalette
    let room: Room
    @EnvironmentObject private var session: Session
    @State private var view: GroupMemoryView?
    @State private var draft = ""
    @State private var error: String?
    @State private var conflict = false
    @State private var saving = false

    var body: some View {
        Group {
            if let view {
                content(view)
            } else {
                ThemedList {
                    Text(error ?? String(localized: "Loading the group memory…"))
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .navigationTitle(String(localized: "Memory"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: room.id) { await load() }
    }

    @ViewBuilder
    private func content(_ view: GroupMemoryView) -> some View {
        let dirty = draft != view.text
        ThemedList {
            Section {
                Toggle(isOn: Binding(get: { view.enabled }, set: { _ in save(enabled: !view.enabled) })) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "Group memory"))
                            .foregroundStyle(Theme.textPrimary)
                        Text(String(localized: "Notes every bot of this group reads at each turn here, and writes when it learns something the whole group should keep. A bot's own memory stays private and never lands here on its own."))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .disabled(!view.canEdit || saving)
                .accessibilityLabel(Text(String(localized: "Let the bots of this group use its memory")))
                .accessibilityIdentifier("room-memory-switch")
                if !view.canEdit {
                    Text(String(localized: "Only the owner of this group can change its memory."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("room-memory-read-only")
                }
                if !view.enabled {
                    Text(String(localized: "Off: the bots neither read nor write it. The notes stay here."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Section {
                RoomMemoryGauge(capacity: view.capacity)
            }
            Section {
                if view.canEdit {
                    TextEditor(text: $draft)
                        .font(.system(size: 13, design: .monospaced))
                        .frame(minHeight: 240)
                        .scrollContentBackground(.hidden)
                        .overlay(alignment: .topLeading) {
                            if draft.isEmpty {
                                Text(String(localized: "- A fact the whole group should keep"))
                                    .font(.system(size: 13, design: .monospaced))
                                    .foregroundStyle(Theme.placeholder)
                                    .padding(.top, 8)
                                    .padding(.leading, 5)
                                    .allowsHitTesting(false)
                            }
                        }
                        .accessibilityLabel(Text(String(localized: "Group memory")))
                        .accessibilityIdentifier("room-memory-editor")
                } else {
                    Text(view.text.isEmpty ? String(localized: "Nothing yet.") : view.text)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(view.text.isEmpty ? Theme.textSecondary : Theme.textPrimary)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("room-memory-text")
                }
            }
            if conflict {
                Section {
                    Text(String(localized: "A bot changed the group memory while you were editing. Nothing was saved."))
                        .foregroundStyle(Theme.textPrimary)
                    Button(String(localized: "Reload")) {
                        conflict = false
                        Task { await load() }
                    }
                    .disabled(saving)
                    Button(String(localized: "Overwrite with mine")) { save(text: draft, expectedHash: nil) }
                        .disabled(saving)
                        .accessibilityIdentifier("room-memory-overwrite")
                }
                .accessibilityIdentifier("room-memory-conflict")
            }
            if let error {
                Section {
                    Text(verbatim: error).foregroundStyle(Theme.danger)
                }
            }
        }
        .toolbar {
            if view.canEdit {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Cancel")) { draft = view.text }
                        .disabled(!dirty || saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Save")) { save(text: draft, expectedHash: view.hash) }
                        .disabled(!dirty || saving)
                        .accessibilityIdentifier("room-memory-save")
                }
            }
        }
    }

    private func load(keepDraft: Bool = false) async {
        do {
            let next = try await session.roomMemory(room)
            view = next
            if !keepDraft { draft = next.text }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func save(text: String? = nil, expectedHash: String? = nil, enabled: Bool? = nil) {
        saving = true
        Task {
            defer { saving = false }
            do {
                let next = try await session.saveRoomMemory(room, text: text, expectedHash: expectedHash, enabled: enabled)
                view = next
                if text != nil { draft = next.text }
                conflict = false
                error = nil
            } catch is GroupMemoryConflict {
                conflict = true
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// How much of the memory loads each turn (MemoryGauge).
struct RoomMemoryGauge: View {
    @Environment(\.themePalette) var themePalette
    let capacity: MemoryCapacity

    var body: some View {
        let level = capacity.level
        let fill = level == .over ? Theme.danger : level == .near ? Theme.warning : Theme.accent
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(String(localized: "How much loads each turn"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                Spacer(minLength: 8)
                Text(verbatim: "\(capacity.lines) / \(capacity.maxLines) · \(MemoryCapacity.formatBytes(capacity.bytes)) / \(MemoryCapacity.formatBytes(capacity.maxBytes))")
                    .font(.system(size: 12))
                    .foregroundStyle(level == .over ? Theme.danger : Theme.textSecondary)
            }
            bar(String(localized: "Lines"), share: capacity.lineShare, fill: fill)
            bar(String(localized: "Size"), share: capacity.byteShare, fill: fill)
            if let warning {
                Text(warning)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.danger)
            }
            Text(String(localized: "\(capacity.lines) of \(capacity.maxLines) lines · \(MemoryCapacity.formatBytes(capacity.bytes)) of \(MemoryCapacity.formatBytes(capacity.maxBytes)). Only the first \(capacity.maxLines) lines load each turn."))
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("room-memory-gauge")
    }

    private var warning: String? {
        guard capacity.truncated else { return nil }
        let missing = capacity.missingLines
        if missing > 0 {
            return String(localized: "\(capacity.lines) lines saved, \(capacity.loadedLines) load into every conversation: \(missing) are not being loaded.")
        }
        return String(localized: "\(MemoryCapacity.formatBytes(capacity.bytes)) saved, \(MemoryCapacity.formatBytes(capacity.loadedBytes)) load into every conversation: the rest is not being loaded.")
    }

    private func bar(_ label: String, share: Double, fill: Color) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 40, alignment: .leading)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.inset)
                    Capsule().fill(fill).frame(width: proxy.size.width * min(1, max(0, share)))
                }
            }
            .frame(height: 6)
        }
    }
}
