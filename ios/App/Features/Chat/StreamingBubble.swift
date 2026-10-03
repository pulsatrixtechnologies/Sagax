// The reply as it is being typed.
import SwiftUI
import CompanionCore

/// The reply as it is being typed, styled to match the settled bubble it is
/// about to become — the handover should be invisible, and any difference in
/// padding or corner radius reads as the message jumping on arrival.
///
/// A caret rather than a spinner: a spinner says "something is happening
/// somewhere", which the reader already knows. A caret at the end of real
/// text says how far along it is.
///
/// The caret does not blink, deliberately. The obvious way to blink it —
/// `withAnimation(.repeatForever) { flag.toggle() }` in `onAppear` — animates
/// the change once and then sits still, and a caret that blinks twice and
/// stops looks more broken than one that never blinks. A correct version
/// animates opacity on a separate view, which needs a device to get right;
/// static is honest until then.
struct StreamingBubble: View {
    @Environment(\.themePalette) var themePalette
    let text: String?
    let reasoning: String?
    var color: String = "blue"

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                if let reasoning, !reasoning.isEmpty, text?.isEmpty != false {
                    AgentThoughtChamberView(
                        reasoning: reasoning,
                        botName: "Bot",
                        mascotColor: MausPalette.color(color),
                        isStreaming: true
                    )
                }
                if let text, !text.isEmpty {
                    // Same renderer as the settled bubble, for the same
                    // reason as the padding: a live reply showing `**bold**`
                    // that snaps to bold on arrival is the message jumping,
                    // just in a different dimension. The parser tolerates the
                    // half-finished markdown this is always holding — an
                    // unclosed fence renders as code, an unclosed link as the
                    // characters typed so far.
                    MarkdownText(source: text, caret: true)
                        .foregroundStyle(BubbleColor.theirsText)
                }
            }
            .padding(.horizontal, Theme.Chat.bubblePaddingH)
            .padding(.vertical, Theme.Chat.bubblePaddingV)
            .background(
                RoundedRectangle(cornerRadius: Theme.Metric.bubbleRadius, style: .continuous)
                    .fill(BubbleColor.theirs)
            )
            Spacer(minLength: Theme.Chat.bubbleTrailingGap)
        }
        // No `.textSelection` on purpose: selecting text that is still growing
        // fights the reader, and the settled bubble a frame later is
        // selectable anyway.
    }
}
