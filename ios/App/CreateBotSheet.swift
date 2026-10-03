// Create New Bot (reference 20): a floating card over the dimmed home with a
// live preview of the character, "Name your Bot", the Character editor where
// the reference has its shape and colour grids, and a Create capsule that
// stays grey until there is a name. The picture is set later, from the
// profile. Geometry from measure-home.md §5, relative to the card
// (x 8-394, y 123.7-865.7).
import SwiftUI
import UIKit
import CompanionCore

struct CreateBotSheet: View {
    @Environment(\.themePalette) var themePalette
    let close: () -> Void
    let created: (Bot) -> Void

    @EnvironmentObject private var session: Session
    @State private var name = ""
    @State private var draft = CharacterDraft()
    @State private var creating = false
    @FocusState private var nameFocused: Bool
    /// How far the keyboard reaches up from the bottom of the screen, 0 when down.
    @State private var keyboardHeight: CGFloat = 0

    /// Card top on the 874 pt screen; the card ends 8 pt above the bottom.
    static let cardTop: CGFloat = 123.67
    private static let cardRadius: CGFloat = Theme.continuous(36)

    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canCreate: Bool { !trimmedName.isEmpty && !creating }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.dim
                .ignoresSafeArea()
                .onTapGesture { if !creating { close() } }
            card
                .padding(.horizontal, Theme.Metric.sheetInset)
                .padding(.top, Self.cardTop)
                .padding(.bottom, Theme.Metric.sheetInset)
                .ignoresSafeArea(edges: [.top, .bottom])
            keyboardCreate
        }
        // The card never moves for the keyboard (reference 20 is the card
        // with the keyboard down); while it is up, `keyboardCreate` rides on it.
        .ignoresSafeArea(.keyboard)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
            guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            let screen = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.screen.bounds.height ?? frame.maxY
            keyboardHeight = max(0, screen - frame.minY)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardHeight = 0
        }
    }

    /// The keyboard covers the card's Create capsule: while it is up, the same
    /// capsule sits just above it, so a name can be confirmed without first
    /// dismissing the keyboard (the return key creates too).
    @ViewBuilder
    private var keyboardCreate: some View {
        if keyboardHeight > 0 && nameFocused {
            VStack {
                Spacer(minLength: 0)
                capsule(identifier: "create-bot-submit-keyboard")
                    .padding(.horizontal, Theme.Metric.sheetInset + 28.67)
                    .padding(.bottom, keyboardHeight + 10)
            }
            .ignoresSafeArea()
            .transition(.opacity)
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            header
            MascotCharacterView(look: draft.complete, color: draft.color, skin: draft.skin, size: 142, animated: true)
                .frame(width: 142, height: 142)
                .padding(.top, 120.1 - 59.6)
                .accessibilityHidden(true)
            nameField
                .padding(.top, 321.6 - 262.1)
            ScrollView(showsIndicators: false) {
                CharacterEditor(draft: $draft, metrics: .createSheet)
                    .padding(.bottom, 12)
            }
            .frame(maxHeight: .infinity)
            createButton
                .padding(.horizontal, 28.67)
                .padding(.bottom, 28.33)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: Self.cardRadius, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: Self.cardRadius, style: .continuous))
        .onTapGesture { nameFocused = false }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("create-bot-sheet")
    }

    private var header: some View {
        HStack(spacing: 14.7) {
            GlassCircleButton(systemImage: "xmark", size: .sheet, accessibilityLabel: "Close") { close() }
            Text("Create New Bot")
                .font(HomeMetrics.name)
                .foregroundStyle(Theme.textPrimary)
            Spacer()
        }
        .padding(.leading, 17.33)
        .padding(.top, 17.33)
        .frame(height: 59.6, alignment: .top)
    }

    private var nameField: some View {
        ZStack {
            if name.isEmpty {
                Text("Name your Bot")
                    .font(.system(size: 17.5, weight: .medium))
                    .foregroundStyle(Theme.parity(Color(hex: 0x5E5E60), Theme.placeholder))
                    .allowsHitTesting(false)
            }
            TextField("", text: $name)
                .font(.system(size: 17.5, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
                .tint(Theme.caret)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($nameFocused)
                // The return key creates. On iOS 27 a create run inside the
                // submit callback itself does nothing (the keyboard is still
                // handling its key); one main-actor turn later it creates.
                .onSubmit { Task { @MainActor in await Task.yield(); create() } }
                .accessibilityLabel(Text("Name your Bot"))
                .accessibilityIdentifier("create-bot-name")
        }
        .padding(.horizontal, 16)
        .frame(height: 47.33)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.continuous(15.5), style: .continuous))
        .padding(.horizontal, 15.33)
    }

    private var createButton: some View { capsule(identifier: "create-bot-submit") }

    private func capsule(identifier: String) -> some View {
        Button(action: create) {
            ZStack {
                if creating {
                    ProgressView().tint(Theme.disabledCapsuleText)
                } else {
                    Text("Create")
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(canCreate ? Theme.primaryInk : Theme.disabledCapsuleText)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 42.67)
            .background(canCreate ? Theme.primaryFill : Theme.parity(Color(hex: 0x9A9A9A), Theme.disabledCapsule), in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    LinearGradient(colors: [Theme.parity(Color(hex: 0xD7D7D7), Theme.hairline), Theme.parity(Color(hex: 0x9A9A9A), Theme.disabledCapsule), Theme.parity(Color(hex: 0xCECECE), Theme.hairline)], startPoint: .top, endPoint: .bottom),
                    lineWidth: 1
                )
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        // not `.disabled`: that dims the grey capsule below the reference's
        .allowsHitTesting(canCreate)
        .accessibilityIdentifier(identifier)
    }

    private func create() {
        guard canCreate else { return }
        creating = true
        nameFocused = false
        let request = NewBotDraft(name: trimmedName, color: draft.color, look: draft.look, skin: draft.skin)
        Task {
            let bot = await session.createBot(request)
            creating = false
            if let bot {
                Haptics.success()
                created(bot)
            }
        }
    }
}
