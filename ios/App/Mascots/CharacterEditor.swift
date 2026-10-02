// The Character editor: which Sagax character stands for a bot and how it
// looks. The create-bot sheet (reference 20) and the profile's Character
// card (03/04, P4) both use it; only the metrics and the optional rows
// differ. It follows the desktop's `MascotLookEditor.tsx`:
//
//   1. Character: Owl, Shape, Trombi, in the bot's colour.
//   2. Shape (Shape only): the 8 shapes as 2x4.
//   3. Skin: owl 7, shape 6, Trombi 4.
//   4. Colour: the 12 Sagax colours as 6+6 (hidden for Trombi).
//   5. Photo (optional): upload or remove a picture.
//   6. Reset to default (optional): the owl, green, no skin, no picture.
//
// Every choice is written to the binding at once; the owner decides whether
// that is a draft (create) or a save (profile).
import PhotosUI
import SwiftUI
import CompanionCore

/// What the editor edits: the stored look, the colour and the owl's skin.
struct CharacterDraft: Equatable {
    var look: MascotLook = .owl
    var color: String = "green"
    var skin: MascotSkin = .none

    /// The desktop's reset (`BotProfileAvatarCard.tsx`).
    static let `default` = CharacterDraft()

    init(look: MascotLook = .owl, color: String = "green", skin: MascotSkin = .none) {
        self.look = look
        self.color = color
        self.skin = skin
    }

    init(bot: Bot) {
        self.init(look: bot.mascotLook ?? .owl, color: bot.color, skin: bot.resolvedMascotSkin)
    }

    var complete: CompleteMascotLook { look.complete }

    var character: MascotCharacter {
        get { look.character }
        set {
            var next = complete
            next.character = newValue
            look = newValue == .owl ? .owl : next.stored
        }
    }

    var newBotDraft: (MascotLook, MascotSkin) { (look, skin) }
}

struct CharacterEditor: View {
    /// Grid sizes: the create sheet's (measured on 20) or the profile card's.
    struct Metrics {
        var cell: CGFloat
        var pitch: CGFloat
        var skinCell: CGFloat
        var skinPitch: CGFloat
        var swatch: CGFloat
        var swatchPitch: CGFloat
        var swatchRowPitch: CGFloat
        /// Skin row centre to first colour row centre.
        var skinToColours: CGFloat
        var topPadding: CGFloat

        /// Reference 20: 34 pt cells on a 57.67 pitch, 25 pt swatches on
        /// 53.33, colour rows 42.1 apart.
        static let createSheet = Metrics(
            cell: 34, pitch: 57.67, skinCell: 26, skinPitch: 35,
            swatch: 25, swatchPitch: 53.33, swatchRowPitch: 42.1, skinToColours: 65.4, topPadding: 25.3
        )

        /// Reference 03: 35 pt cells on a 60 pt pitch, 26 pt swatches on 53.
        static let profileCard = Metrics(
            cell: 35, pitch: 60, skinCell: 27, skinPitch: 36,
            swatch: 26, swatchPitch: 53, swatchRowPitch: 42, skinToColours: 62, topPadding: 20
        )
    }

    @Binding var draft: CharacterDraft
    var metrics: Metrics = .createSheet
    /// The picture row (Upload, Remove): the profile shows it, create does not.
    var showsPhotoRow = false
    /// "Reset to default": the profile shows it, create does not.
    var showsReset = false
    var hasPhoto = false
    var onPhotoPicked: ((Data) -> Void)?
    var onRemovePhoto: (() -> Void)?
    /// Called after the draft is reset, so the owner also clears the picture
    /// (`avatarCrop: mascot`).
    var onReset: (() -> Void)?

    @State private var photoItem: PhotosPickerItem?

    private static let ringGap: CGFloat = 2.7
    private static let ringWidth: CGFloat = 2

    var body: some View {
        VStack(spacing: 0) {
            row(count: 3, pitch: metrics.pitch, height: metrics.pitch) { index in
                let character = MascotCharacter.allCases[index]
                thumbnail(
                    look: lookFor(character),
                    skin: character == .owl ? draft.skin : .none,
                    size: metrics.cell,
                    selected: draft.character == character,
                    label: Text(characterName(character))
                ) {
                    draft.character = character
                }
            }

            if draft.character == .shape {
                ForEach(0..<2, id: \.self) { line in
                    row(count: 4, pitch: metrics.pitch, height: metrics.pitch) { index in
                        let shape = MascotShape.allCases[line * 4 + index]
                        thumbnail(look: edited { $0.shape = shape }, skin: .none, size: metrics.cell, selected: draft.complete.shape == shape, label: Text(verbatim: shape.rawValue)) {
                            var next = draft.complete
                            next.shape = shape
                            draft.look = next.stored
                        }
                    }
                }
            }

            skinRow

            if draft.character != .trombi {
                colourRows
                    .padding(.top, metrics.skinToColours - metrics.pitch / 2 - metrics.swatch / 2)
            }

            if showsPhotoRow { photoRow.padding(.top, 20) }
            if showsReset { resetRow.padding(.top, 12) }
        }
        .padding(.top, metrics.topPadding)
        .frame(maxWidth: .infinity)
        .animation(.snappy(duration: 0.2), value: draft)
    }

    // MARK: Rows

    @ViewBuilder private var skinRow: some View {
        switch draft.character {
        case .owl:
            let skins = MascotSkin.allCases
            row(count: skins.count, pitch: metrics.skinPitch, height: metrics.pitch) { index in
                thumbnail(look: MascotLook.owl.complete, skin: skins[index], size: metrics.skinCell, selected: draft.skin == skins[index], label: Text(verbatim: skins[index].rawValue)) {
                    draft.skin = skins[index]
                }
            }
        case .shape:
            let skins = ShapeSkin.allCases
            row(count: skins.count, pitch: metrics.skinPitch, height: metrics.pitch) { index in
                thumbnail(look: edited { $0.shapeSkin = skins[index] }, skin: .none, size: metrics.skinCell, selected: draft.complete.shapeSkin == skins[index], label: Text(verbatim: skins[index].rawValue)) {
                    var next = draft.complete
                    next.shapeSkin = skins[index]
                    draft.look = next.stored
                }
            }
        case .trombi:
            let skins = TrombiSkin.allCases
            row(count: skins.count, pitch: metrics.pitch, height: metrics.pitch) { index in
                thumbnail(look: edited { $0.trombiSkin = skins[index] }, skin: .none, size: metrics.cell, selected: draft.complete.trombiSkin == skins[index], label: Text(verbatim: skins[index].rawValue)) {
                    var next = draft.complete
                    next.trombiSkin = skins[index]
                    draft.look = next.stored
                }
            }
        }
    }

    private var colourRows: some View {
        let names = MausColors.names
        return VStack(spacing: metrics.swatchRowPitch - metrics.swatch) {
            ForEach(0..<2, id: \.self) { line in
                HStack(spacing: metrics.swatchPitch - metrics.swatch) {
                    ForEach(0..<6, id: \.self) { index in
                        swatch(names[line * 6 + index])
                    }
                }
                // the second row sits half a pitch to the right
                .offset(x: line == 0 ? -metrics.swatchPitch / 4 : metrics.swatchPitch / 4)
            }
        }
    }

    private func swatch(_ name: String) -> some View {
        let selected = draft.color == name
        return Button {
            Haptics.selection()
            draft.color = name
        } label: {
            Circle()
                .fill(MausPalette.color(name))
                .frame(width: metrics.swatch, height: metrics.swatch)
                .overlay {
                    if selected {
                        Circle()
                            .strokeBorder(Theme.selectionRing, lineWidth: Self.ringWidth)
                            .frame(width: metrics.swatch + 2 * (Self.ringGap + Self.ringWidth), height: metrics.swatch + 2 * (Self.ringGap + Self.ringWidth))
                    }
                }
                .frame(width: metrics.swatch, height: metrics.swatch)
                .contentShape(Circle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var photoRow: some View {
        HStack(spacing: 12) {
            Text("Photo")
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textPrimary)
            Spacer()
            PhotosPicker(selection: $photoItem, matching: .images) {
                Text("Upload").font(Theme.Font.rowTitle).foregroundStyle(Theme.blue)
            }
            if hasPhoto {
                Button {
                    onRemovePhoto?()
                } label: {
                    Text("Remove").font(Theme.Font.rowTitle).foregroundStyle(Theme.destructive)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, Theme.Metric.rowInset)
        .frame(height: Theme.Metric.rowHeight)
        .onValueChange(of: photoItem) { item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) { onPhotoPicked?(data) }
                photoItem = nil
            }
        }
    }

    private var resetRow: some View {
        Button {
            Haptics.selection()
            draft = .default
            onReset?()
        } label: {
            Text("Reset to default")
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.blue)
                .frame(maxWidth: .infinity)
                .frame(height: Theme.Metric.rowHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Parts

    /// `count` cells centred on a `pitch`, in a row `height` tall.
    private func row<Cell: View>(count: Int, pitch: CGFloat, height: CGFloat, @ViewBuilder cell: @escaping (Int) -> Cell) -> some View {
        HStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { index in
                cell(index).frame(width: pitch, height: height)
            }
        }
        .frame(height: height)
    }

    private func thumbnail(look: CompleteMascotLook, skin: MascotSkin, size: CGFloat, selected: Bool, label: Text, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            MascotCharacterView(look: look, color: draft.color, skin: skin, size: size)
                .frame(width: size, height: size)
                .modifier(SilhouetteRing(visible: selected, gap: Self.ringGap, width: Self.ringWidth))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

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

    private func characterName(_ character: MascotCharacter) -> LocalizedStringResource {
        switch character {
        case .owl: "Owl"
        case .shape: "Shape"
        case .trombi: "Trombi"
        }
    }
}

/// The selection outline that follows a mascot's own silhouette: a ring
/// `width` wide, `gap` away from the shape (reference 20's cloud).
struct SilhouetteRing: ViewModifier {
    let visible: Bool
    var gap: CGFloat = 2.7
    var width: CGFloat = 2
    var ring: Color = Theme.selectionRing
    var background: Color = Theme.bg

    func body(content: Content) -> some View {
        if visible {
            content.background {
                ZStack {
                    stamp(content, color: ring, radius: gap + width)
                    stamp(content, color: background, radius: gap)
                }
            }
        } else {
            content
        }
    }

    private func stamp(_ content: Content, color: Color, radius: CGFloat) -> some View {
        ZStack {
            ForEach(0..<20, id: \.self) { i in
                let a = Double(i) / 20 * 2 * .pi
                color.mask(content).offset(x: cos(a) * radius, y: sin(a) * radius)
            }
        }
    }
}
