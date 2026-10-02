// Create New Bot (reference 20): a floating card over the dimmed home with a
// live preview of the character, "Name your Bot", the Character editor where
// the reference has its shape and colour grids, and a Create capsule that
// stays grey until there is a name. The picture is set later, from the
// profile. Geometry from measure-home.md §5, relative to the card
// (x 8-394, y 123.7-865.7).
import SwiftUI
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
        }
        .ignoresSafeArea(.keyboard)
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
                    .foregroundStyle(Color(hex: 0x5E5E60))
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
                .onSubmit(create)
                .accessibilityLabel(Text("Name your Bot"))
                .accessibilityIdentifier("create-bot-name")
        }
        .padding(.horizontal, 16)
        .frame(height: 47.33)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.continuous(15.5), style: .continuous))
        .padding(.horizontal, 15.33)
    }

    private var createButton: some View {
        Button(action: create) {
            ZStack {
                if creating {
                    ProgressView().tint(Theme.disabledCapsuleText)
                } else {
                    Text("Create")
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(canCreate ? Color.black : Theme.disabledCapsuleText)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 42.67)
            .background(canCreate ? Color.white : Color(hex: 0x9A9A9A), in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    LinearGradient(colors: [Color(hex: 0xD7D7D7), Color(hex: 0x9A9A9A), Color(hex: 0xCECECE)], startPoint: .top, endPoint: .bottom),
                    lineWidth: 1
                )
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        // not `.disabled`: that dims the grey capsule below the reference's
        .allowsHitTesting(canCreate)
        .accessibilityIdentifier("create-bot-submit")
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
