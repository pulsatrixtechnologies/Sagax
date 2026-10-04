// iPad I4: the character editor the panel's mascot opens (`Edit avatar`,
// `BotProfileAvatarCard.tsx` with `floating-bots/MascotLookEditor.tsx`),
// as desktop-*-34-panel-avatar-editor draws it: a 452 pt card (radius 16,
// hairline/50 ring, `bg-card`, 14 pt in, shadow) 8 pt under the mascot,
// its trailing edge 12 pt inside the panel, so it reaches over the chat.
// Tabs Bot / Generate / Upload and Reset (12 pt); on Bot: the 64 pt
// preview, Character (three 64 tall cells), Color (24 pt swatches), Skin
// (seven 60 tall cells), Style (2D, 3D) and the owl's Moves. Saved as each
// choice is made (`PATCH /api/bots/:id/profile`), as on the desktop.
import PhotosUI
import SwiftUI
import UIKit
import CompanionCore

/// The editor over the panel: docked, its trailing edge 12 pt inside the
/// panel (it reaches over the chat); over the leading edge below 1024, its
/// leading edge 12 pt in.
struct BotAvatarEditorLayer: View {
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let docked: Bool

    var body: some View {
        BotAvatarEditor(bot: bot, close: close)
            .padding(.top, 187)
            .padding(docked ? .trailing : .leading, 12)
    }

    private func close() {
        withAnimation(.easeOut(duration: 0.15)) { model.avatarEditorOpen = false }
    }
}

struct BotAvatarEditor: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let close: () -> Void

    enum Tab: String, CaseIterable { case bot, generate, upload }

    @State private var tab: Tab = .bot
    @State private var draft = CharacterDraft()
    @State private var unlocks: MascotUnlocks = .nothingLocked
    @State private var prompt = ""
    @State private var working = false
    @State private var photo: PhotosPickerItem?
    @State private var config: ConfigStatus?

    private var canGenerate: Bool { session.canAdminister && config?.imageGen?.configured == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                ForEach(Tab.allCases, id: \.self) { item in
                    Button { tab = item } label: {
                        Text(title(item))
                            .font(theme.font(12))
                            .foregroundStyle(tab == item ? theme.ink : theme.inkSecondary)
                            .padding(.horizontal, 8)
                            .frame(height: 26)
                            .background(tab == item ? theme.control : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(tab == item ? .isSelected : [])
                    .accessibilityIdentifier("avatar-tab.\(item.rawValue)")
                }
                Spacer(minLength: 0)
                Button {
                    draft = .default
                    Task { await edit(.resetLook) }
                } label: {
                    Text("Reset").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                        .padding(.horizontal, 8).frame(height: 26).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("avatar-reset")
            }
            Group {
                switch tab {
                case .bot: AnyView(botTab)
                case .generate: AnyView(generateTab)
                case .upload: AnyView(uploadTab)
                }
            }
            .padding(.top, 11)
        }
        .padding(14)
        .frame(width: 452, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline50, lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 24, y: 12)
        .overlay { if working { ProgressView().controlSize(.large) } }
        .onAppear { draft = CharacterDraft(bot: bot) }
        .onValueChange(of: CharacterDraft(bot: bot)) { server in if !working { draft = server } }
        .task {
            config = await session.configStatus()
            if session.surfaceGate.allows(.characterExtras), session.surfaceGate.allows(.achievements),
               let client = session.profileClient {
                unlocks = (try? await client.mascotUnlocks()) ?? .nothingLocked
            }
        }
        .onValueChange(of: photo) { item in
            guard let item else { return }
            Task { await upload(item) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Edit avatar"))
        .accessibilityIdentifier("desktop-avatar-editor")
    }

    private func title(_ tab: Tab) -> LocalizedStringKey {
        switch tab {
        case .bot: "Bot"
        case .generate: "Generate"
        case .upload: "Upload"
        }
    }

    // MARK: Bot

    private var botTab: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                MascotCharacterView(look: draft.complete, color: draft.color, skin: draft.character == .owl ? draft.skin : .none, size: 60)
                    .frame(width: 64, height: 64)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.top, 11)
                VStack(alignment: .leading, spacing: 6) {
                    label("Character")
                    HStack(spacing: 6) {
                        ForEach(MascotCharacter.allCases, id: \.self) { character in
                            cell(look: lookFor(character), skin: character == .owl ? draft.skin : .none,
                                 name: characterName(character), selected: draft.character == character, height: 64,
                                 locked: unlocks.characterLocked(character, current: CharacterDraft(bot: bot).character)) {
                                var next = draft
                                next.character = character
                                save(next)
                            }
                        }
                    }
                }
            }
            if draft.character == .shape {
                label("Shape").padding(.top, 12)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 4), spacing: 4) {
                    ForEach(MascotShape.allCases, id: \.self) { shape in
                        cell(look: edited { $0.shape = shape }, skin: .none, name: shape.rawValue.capitalized,
                             selected: draft.complete.shape == shape, height: 56, locked: false) {
                            var next = draft
                            var look = next.complete
                            look.shape = shape
                            next.look = look.stored
                            save(next)
                        }
                    }
                }
                .padding(.top, 6)
            }
            if draft.character != .trombi {
                label("Color").padding(.top, 12)
                HStack(spacing: 6) {
                    ForEach(MausColors.names, id: \.self) { name in swatch(name) }
                }
                .padding(.top, 6)
            }
            label("Skin").padding(.top, 12)
            skins.padding(.top, 6)
            if draft.character == .owl {
                label("Style").padding(.top, 12)
                HStack(spacing: 6) {
                    ForEach(MascotStyle.allCases, id: \.self) { style in
                        chip(CharacterMovesMenu.name(style), selected: draft.complete.style == style) {
                            var next = draft
                            var look = next.complete
                            look.style = style
                            next.look = look.stored
                            save(next)
                        }
                    }
                }
                .padding(.top, 6)
                label("Moves").padding(.top, 12)
                HStack(spacing: 6) {
                    ForEach(OwlWingMove.allCases, id: \.self) { move in
                        chip(CharacterMovesMenu.name(move), selected: false) {
                            model.avatarMove = nil
                            DispatchQueue.main.async { model.avatarMove = move }
                        }
                        .accessibilityIdentifier("avatar-move.\(move.rawValue)")
                    }
                }
                .padding(.top, 6)
            }
        }
    }

    @ViewBuilder
    private var skins: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        let worn = CharacterDraft(bot: bot)
        switch draft.character {
        case .owl:
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(MascotSkin.allCases, id: \.self) { skin in
                    cell(look: MascotLook.owl.complete, skin: skin, name: skinName(skin.rawValue), selected: draft.skin == skin, height: 60,
                         locked: unlocks.skinLocked(.owl, skin: skin.rawValue, current: worn.skin.rawValue)) {
                        var next = draft
                        next.skin = skin
                        save(next)
                    }
                }
            }
        case .shape:
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(ShapeSkin.allCases, id: \.self) { skin in
                    cell(look: edited { $0.shapeSkin = skin }, skin: .none, name: skinName(skin.rawValue), selected: draft.complete.shapeSkin == skin, height: 60,
                         locked: unlocks.skinLocked(.shape, skin: skin.rawValue, current: worn.complete.shapeSkin.rawValue)) {
                        var next = draft
                        var look = next.complete
                        look.shapeSkin = skin
                        next.look = look.stored
                        save(next)
                    }
                }
            }
        case .trombi:
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(TrombiSkin.allCases, id: \.self) { skin in
                    cell(look: edited { $0.trombiSkin = skin }, skin: .none, name: skinName(skin.rawValue), selected: draft.complete.trombiSkin == skin, height: 60,
                         locked: unlocks.skinLocked(.trombi, skin: skin.rawValue, current: worn.complete.trombiSkin.rawValue)) {
                        var next = draft
                        var look = next.complete
                        look.trombiSkin = skin
                        next.look = look.stored
                        save(next)
                    }
                }
            }
        }
    }

    private func label(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .textCase(.uppercase)
            .font(theme.font(11, .medium))
            .tracking(0.88)
            .foregroundStyle(theme.inkSecondary)
            .frame(height: 16.5)
    }

    private func cell(look: CompleteMascotLook, skin: MascotSkin, name: String, selected: Bool, height: CGFloat, locked: Bool, action: @escaping () -> Void) -> some View {
        Button { if !locked { action() } } label: {
            VStack(spacing: 2) {
                MascotCharacterView(look: look, color: draft.color, skin: skin, size: height - 28)
                    .frame(width: height - 28, height: height - 28)
                Text(verbatim: name)
                    .font(theme.font(11))
                    .foregroundStyle(selected ? theme.ink : theme.inkSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(selected ? theme.accent : .clear, lineWidth: 2))
            .overlay(alignment: .topTrailing) {
                if locked {
                    Image(systemName: "lock.fill").font(.system(size: 8)).foregroundStyle(theme.inkSecondary).padding(4)
                }
            }
            .opacity(locked ? 0.6 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(locked ? Text("Locked") : Text(verbatim: ""))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func swatch(_ name: String) -> some View {
        let selected = draft.color == name
        return Button {
            var next = draft
            next.color = name
            save(next)
        } label: {
            Circle()
                .fill(MausPalette.color(name))
                .frame(width: 24, height: 24)
                .overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 1))
                .overlay {
                    if selected {
                        Circle().strokeBorder(Color.white.opacity(0.8), lineWidth: 2).frame(width: 32, height: 32)
                    }
                }
                .frame(width: 24, height: 24)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Use \(name) mascot color"))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func chip(_ text: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(verbatim: text)
                .font(theme.font(12.5))
                .foregroundStyle(theme.ink)
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(selected ? theme.control : theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: Generate, Upload

    private var generateTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            if canGenerate {
                Text("Describe the picture. It is made with the image provider set up on your computer.")
                    .panelText(12.5, 19).foregroundStyle(theme.inkSecondary)
                PanelTextArea(placeholder: "Art direction", text: $prompt, minHeight: 80)
                PanelButton(title: "Generate", systemImage: "sparkles", prominent: true,
                            disabled: working || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                    Task { await generate() }
                }
            } else {
                Text("To generate pictures, set up the shared image provider in Sagax on your computer. Provider keys cannot be added from this device.")
                    .panelText(12.5, 19).foregroundStyle(theme.inkSecondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var uploadTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("PNG, JPEG, GIF, or WebP, up to 10 MB. Images are stored on your paired computer.")
                .panelText(12.5, 19).foregroundStyle(theme.inkSecondary)
            HStack(spacing: 8) {
                PhotosPicker(selection: $photo, matching: .images) {
                    Label("Choose a picture", systemImage: "photo.badge.plus")
                        .font(theme.font(12.5, .medium))
                        .foregroundStyle(theme.ink)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .disabled(working)
                if bot.avatarUrl != nil {
                    PanelButton(title: "Use the character", systemImage: "trash", disabled: working) {
                        Task { await edit(BotProfileEdit(avatarCrop: .mascot, avatarUrl: .clear)) }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: Saving

    private func save(_ next: CharacterDraft) {
        let previous = draft
        guard next != previous else { return }
        draft = next
        var change = BotProfileEdit()
        if next.color != previous.color { change.color = next.color }
        if next.look != previous.look { change.mascotLook = next.look }
        if next.skin != previous.skin { change.mascotSkin = next.skin }
        guard !change.isEmpty else { return }
        Task {
            if !(await edit(change)) { draft = previous }
        }
    }

    @discardableResult
    private func edit(_ change: BotProfileEdit) async -> Bool {
        guard let client = session.profileClient else { return false }
        do {
            session.applyProfileBot(try await client.editBot(botId: bot.id, edit: change))
            return true
        } catch {
            session.actionError = error.localizedDescription
            return false
        }
    }

    private func generate() async {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        working = true
        defer { working = false }
        if await session.generateAvatar(prompt: String(text.prefix(400)), for: bot) != nil { close() }
    }

    private func upload(_ item: PhotosPickerItem) async {
        working = true
        defer { working = false; photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        guard let mime = Self.imageMIME(data) else {
            session.actionError = String(localized: "Choose a PNG, JPEG, GIF, or WebP image.")
            return
        }
        let crop = bot.avatarCrop.flatMap { $0 == .mascot ? nil : $0 } ?? .circle
        if await session.uploadAvatar(data, mime: mime, for: bot, crop: crop) != nil { close() }
    }

    private static func imageMIME(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if bytes.starts(with: [0x47, 0x49, 0x46]) { return "image/gif" }
        if bytes.count >= 12, bytes[0...3] == [0x52, 0x49, 0x46, 0x46], bytes[8...11] == [0x57, 0x45, 0x42, 0x50] { return "image/webp" }
        return nil
    }

    // MARK: Looks

    private func edited(_ change: (inout CompleteMascotLook) -> Void) -> CompleteMascotLook {
        var look = draft.complete
        change(&look)
        return look
    }

    private func lookFor(_ character: MascotCharacter) -> CompleteMascotLook {
        var look = draft.complete
        look.character = character
        return look
    }

    private func characterName(_ character: MascotCharacter) -> String {
        switch character {
        case .owl: String(localized: "Owl")
        case .shape: String(localized: "Original shapes")
        case .trombi: String(localized: "Trombi")
        }
    }

    private func skinName(_ raw: String) -> String {
        switch raw {
        case "none": String(localized: "None")
        case "frost": String(localized: "Ice")
        default: raw.capitalized
        }
    }
}
