// The character editor the panel's mascot opens (`Edit avatar`,
// `BotProfileAvatarCard.tsx` with `MascotLookEditor.tsx`): character,
// colour, skin, the picture row (upload, generate, frame, remove), the
// picture's shape, and Reset. Each choice saves at once, as on the desktop.
// Moved from the profile's Info tab "Character" card and the retired
// "Bot settings" sheet's Avatar and Generate sections.
import CompanionCore
import SwiftUI
import UIKit

struct PhoneBotAvatarSheet: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let bot: Bot
    @Binding var draft: CharacterDraft

    @State private var unlocks: MascotUnlocks = .nothingLocked
    @State private var generating = false
    @State private var generatePrompt = ""
    @State private var askingGenerate = false
    @State private var framing = false

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    BotMascotView(bot: current, size: Theme.Profile.mascot, state: .idle, animated: true)
                        .padding(.top, 12)
                        .padding(.bottom, 20)
                    AnyView(editorCard)
                    if current.avatarUrl != nil {
                        AnyView(shapeCard).padding(.top, Theme.Profile.cardGap)
                    }
                }
                .padding(.bottom, 40)
            }
            .background(Theme.bg)
            .navigationTitle(Text("Edit avatar"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) { dismiss() }.accessibilityIdentifier("avatar-done")
                }
            }
        }
        .sheet(isPresented: $framing) {
            PictureFramingSheet(bot: current) { zoom, x, y in
                Task { await edit(BotProfileEdit(avatarZoom: zoom, avatarFocusX: x, avatarFocusY: y)) }
            }
        }
        .alert(String(localized: "Generate a picture"), isPresented: $askingGenerate) {
            TextField(String(localized: "Art direction"), text: $generatePrompt)
            Button(String(localized: "Generate")) { Task { await generatePicture() } }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text("Describe the picture. It is made with the image provider set up on your computer.")
        }
        .task {
            if let earned = try? await session.profileClient?.mascotUnlocks() { unlocks = earned }
        }
    }

    private var editorCard: some View {
        ProfileCard {
            CharacterEditor(
                draft: Binding(get: { draft }, set: { saveLook($0) }),
                metrics: .profileCard,
                showsPhotoRow: true,
                showsReset: false,
                hasPhoto: current.avatarUrl != nil,
                onPhotoPicked: { data in Task { await uploadPicture(data) } },
                onRemovePhoto: { Task { await edit(BotProfileEdit(avatarCrop: .mascot, avatarUrl: .clear)) } },
                onGeneratePhoto: { generatePrompt = ""; askingGenerate = true },
                onFramePhoto: { framing = true },
                unlocks: session.surfaceGate.allows(.characterExtras) ? unlocks : .nothingLocked
            )
            .frame(height: 252, alignment: .top)
            .clipped()
            .overlay { if generating { ProgressView().controlSize(.large) } }
            ProfileDivider(leading: Theme.Profile.textInset)
            Button {
                Haptics.selection()
                draft = .default
                Task { await edit(.resetLook) }
            } label: {
                Text("Reset to default")
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.accentText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, Theme.Profile.textInset)
                    .frame(height: Theme.Profile.row)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("character-reset")
        }
    }

    /// The picture's shape (the desktop's crop choice).
    private var shapeCard: some View {
        ProfileCard {
            Picker(String(localized: "Shape"), selection: Binding(get: { current.avatarCrop ?? .circle }, set: { crop in
                var patch = BotProfilePatch()
                patch.avatarCrop = crop
                let target = current
                Task { _ = await session.updateProfile(patch, for: target) }
            })) {
                Text("Circle").tag(AvatarCrop.circle)
                Text("Rounded").tag(AvatarCrop.rounded)
                Text("Square").tag(AvatarCrop.square)
            }
            .pickerStyle(.segmented)
            .padding(12)
            .accessibilityIdentifier("avatar-shape")
        }
    }

    /// Shown at once, saved at once, put back if the server refuses.
    private func saveLook(_ next: CharacterDraft) {
        let previous = draft
        guard next != previous else { return }
        draft = next
        var change = BotProfileEdit()
        if next.color != previous.color { change.color = next.color }
        if next.look != previous.look { change.mascotLook = next.look }
        if next.skin != previous.skin { change.mascotSkin = next.skin }
        guard !change.isEmpty else { return }
        Task { await edit(change, revert: { draft = previous }) }
    }

    @discardableResult
    private func edit(_ change: BotProfileEdit, revert: (() -> Void)? = nil) async -> Bool {
        guard let client = session.profileClient else { revert?(); return false }
        do {
            session.applyProfileBot(try await client.editBot(botId: bot.id, edit: change))
            return true
        } catch {
            revert?()
            session.actionError = error.localizedDescription
            return false
        }
    }

    private func uploadPicture(_ data: Data) async {
        guard let mime = Self.imageMIME(data) else {
            session.actionError = String(localized: "Choose a PNG, JPEG, GIF, or WebP image.")
            return
        }
        if data.count > 10 * 1_024 * 1_024 {
            session.actionError = String(localized: "That image is larger than 10 MB.")
            return
        }
        let crop = current.avatarCrop.flatMap { $0 == .mascot ? nil : $0 } ?? .circle
        _ = await session.uploadAvatar(data, mime: mime, for: current, crop: crop)
    }

    private func generatePicture() async {
        let prompt = generatePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        generating = true
        defer { generating = false }
        _ = await session.generateAvatar(prompt: String(prompt.prefix(400)), for: current)
    }

    static func imageMIME(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4e, 0x47]) { return "image/png" }
        if bytes.starts(with: [0xff, 0xd8, 0xff]) { return "image/jpeg" }
        if bytes.starts(with: Array("GIF8".utf8)) { return "image/gif" }
        if bytes.count >= 12,
           String(bytes: bytes[0..<4], encoding: .ascii) == "RIFF",
           String(bytes: bytes[8..<12], encoding: .ascii) == "WEBP" { return "image/webp" }
        return nil
    }
}
