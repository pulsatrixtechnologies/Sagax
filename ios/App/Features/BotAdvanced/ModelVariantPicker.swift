// Reasoning variants (BA7, ModelPicker.tsx ModelVariantRow): an engine with
// `capabilities.modelVariants` takes a model-specific variant instead of an
// effort level. "Use session setting" sends none; a saved variant the model
// no longer offers shows as unverified, as on the desktop. The phone reads
// the catalog's variants (the desktop also hears a live session's report).
import CompanionCore
import SwiftUI

struct ModelVariantPicker: View {
    @Environment(\.themePalette) var themePalette
    let options: [ModelVariantOption]
    /// The variant saved on the bot, for the "unverified" row.
    let saved: String?
    @Binding var variant: String?

    private var missing: Bool { variant.map { v in !options.contains { $0.id == v } } ?? false }

    var body: some View {
        Picker(String(localized: "Reasoning variant"), selection: $variant) {
            Text(String(localized: "Use session setting")).tag(String?.none)
            if missing, let variant {
                Text(String(localized: "\(variant) (unverified)")).tag(Optional(variant)).disabled(true)
            }
            ForEach(options) { option in
                Text(verbatim: ModelVariantRules.label(option)).tag(Optional(option.id))
            }
        }
        .accessibilityIdentifier("model-variant")
        if missing {
            Text(String(localized: "Saved variant has not been checked in this session."))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        } else if variant == nil {
            Text(String(localized: "No variant selected."))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
    }
}
