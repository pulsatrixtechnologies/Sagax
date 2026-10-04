import CompanionCore
import SwiftUI

/// The question card: what the bot actually asked, and its own answers.
///
/// A structured ask (Claude's `AskUserQuestion`) reaches the harness through
/// the permission channel, so before this it drew the ordinary card — a flat
/// row of buttons over "which model should this bot run on?". One tap could
/// not say WHICH question it answered, so a multi-question ask had nothing
/// tappable at all and the phone could only watch it time out.
///
/// The desktop's `src/components/QuestionCard.tsx`, in SwiftUI: a tab per
/// question, the model's options with their glosses, an "Other" row for a
/// reply it did not think of, and one submit that sends every answer at once.
/// The answer text is built by `AskQuestionAnswer.format`, so an answer given
/// here is byte-for-byte the one the Mac would have sent.
struct QuestionCardView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let message: Message
    @EnvironmentObject private var session: Session

    /// Per question: the option labels ticked, and the free-text reply.
    @State private var picked: [Int: Set<String>] = [:]
    @State private var custom: [Int: String] = [:]
    @State private var other: Set<Int> = []
    @State private var active = 0
    @State private var answering = false
    /// The harness settles the card, but only after a round trip. Holding the
    /// sent answer closes the window where the buttons are still live.
    @State private var sent: String?
    @FocusState private var otherFocused: Bool
    /// iPad desktop shell: QuestionCard.tsx's card (card fill, accent ring
    /// at 40 %, radius 16, 16 in, at most 840 wide).
    @Environment(\.desktopChatText) private var desktop

    private var tint: Color { MausPalette.color(chat.color) }

    private var card: OptionCard? { message.card }
    private var questions: [AskQuestion] { card?.questions ?? [] }

    private var index: Int { min(active, max(questions.count - 1, 0)) }
    private var current: AskQuestion? { questions.indices.contains(index) ? questions[index] : nil }

    /// An open "Other" field with nothing in it is not an answer.
    private func answers(for position: Int) -> [String] {
        var chosen = Array(picked[position] ?? []).sorted()
        if other.contains(position) {
            let typed = (custom[position] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !typed.isEmpty { chosen.append(typed) }
        }
        return chosen
    }

    private func isAnswered(_ position: Int) -> Bool { !answers(for: position).isEmpty }
    private var complete: Bool { questions.indices.allSatisfy(isAnswered) }
    private var answeredCount: Int { questions.indices.filter(isAnswered).count }
    private var settled: Bool { (card?.answered != nil) || sent != nil }

    var body: some View {
        if let card, !questions.isEmpty {
            VStack(alignment: .leading, spacing: desktop == nil ? 10 : 12) {
                header(card)
                if card.questionRequest?.origin == "output" {
                    Text("Agent-composed question")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.attentionSecondary)
                }
                if questions.count > 1 { tabs }
                if let current {
                    Text(current.question)
                        .font(desktop?.font(15) ?? .system(size: 15))
                        .lineSpacing(desktop == nil ? 0 : 5)
                        .frame(minHeight: desktop == nil ? 0 : 24.4)
                        .foregroundStyle(desktop?.ink ?? Theme.attentionText)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    if !settled {
                        if current.allowsMultiple {
                            Text("Choose all that apply")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.attentionSecondary)
                        }
                        choices(current)
                    }
                }
                if settled {
                    answeredSummary(card)
                } else {
                    submit
                }
            }
            .modifier(QuestionCardChrome(desktop: desktop, settled: settled, tint: tint))
        }
    }

    @ViewBuilder
    private func header(_ card: OptionCard) -> some View {
        if let desktop {
            HStack(alignment: .firstTextBaseline) {
                Text("\(chat.name) has a question")
                    .font(desktop.font(15, .semibold))
                    .foregroundStyle(desktop.ink)
                    .frame(minHeight: 22.5)
                Spacer(minLength: 8)
                if questions.count > 1, !settled {
                    Text("\(answeredCount) of \(questions.count)")
                        .font(desktop.font(12).monospacedDigit())
                        .foregroundStyle(desktop.inkSecondary)
                }
            }
        } else {
            phoneHeader(card)
        }
    }

    private func phoneHeader(_ card: OptionCard) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Label("\(chat.name) has a question", systemImage: "questionmark.bubble.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(settled ? Theme.attentionSecondary : Theme.readable(tint))
            Spacer(minLength: 8)
            if questions.count > 1, !settled {
                Text("\(answeredCount) of \(questions.count)")
                    .font(.system(size: 12).monospacedDigit())
                    .foregroundStyle(Theme.attentionSecondary)
            }
        }
    }

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(questions.enumerated()), id: \.offset) { position, question in
                    Button {
                        Haptics.selection()
                        active = position
                    } label: {
                        HStack(spacing: 4) {
                            if isAnswered(position) {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 10, weight: .bold))
                            }
                            Text(question.tabLabel(position: position + 1))
                                .font(.system(size: 13, weight: position == index ? .semibold : .regular))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            Capsule().fill(position == index ? Theme.cardRaised : Color.clear)
                        )
                        .foregroundStyle(position == index ? Theme.attentionText : Theme.attentionSecondary)
                    }
                    .buttonStyle(.plain)
                    .disabled(settled)
                }
            }
        }
    }

    @ViewBuilder
    private func choices(_ question: AskQuestion) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(question.options.enumerated()), id: \.offset) { position, option in
                if position > 0 { divider }
                row(
                    label: option.label,
                    detail: option.detail,
                    checked: picked[index]?.contains(option.label) == true,
                    multi: question.allowsMultiple
                ) { choose(option.label, in: question) }
            }
            if !question.options.isEmpty { divider }
            row(
                label: String(localized: "Other"),
                detail: nil,
                checked: other.contains(index),
                multi: question.allowsMultiple
            ) { toggleOther(question) }
            if other.contains(index) {
                divider
                TextField("Type your own answer", text: binding(forCustom: index), axis: .vertical)
                    .font(.system(size: 15))
                    .lineLimit(1...4)
                    .focused($otherFocused)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
            }
        }
        .background {
            if desktop == nil {
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.cardRaised)
            }
        }
        .overlay {
            if let desktop {
                RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(desktop.hairline.opacity(0.4), lineWidth: 1)
            }
        }
    }

    @ViewBuilder
    private var divider: some View {
        if let desktop {
            Rectangle().fill(desktop.hairline.opacity(0.4)).frame(height: 1)
        } else {
            Divider().opacity(0.4)
        }
    }

    @ViewBuilder
    private func row(
        label: String,
        detail: String?,
        checked: Bool,
        multi: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: {
            Haptics.selection()
            action()
        }) {
            HStack(alignment: .top, spacing: desktop == nil ? 10 : 12) {
                if let desktop {
                    // a 16 pt ring (hairline), filled with the accent when picked
                    Circle()
                        .strokeBorder(checked ? desktop.accent : desktop.hairline, lineWidth: checked ? 5 : 1)
                        .frame(width: 16, height: 16)
                        .padding(.top, 2)
                } else {
                    Image(systemName: marker(checked: checked, multi: multi))
                        .font(.system(size: 17))
                        .foregroundStyle(checked ? tint : Theme.attentionSecondary)
                }
                VStack(alignment: .leading, spacing: desktop == nil ? 2 : 0) {
                    Text(label)
                        .font(desktop?.font(14.5, detail == nil ? .regular : .medium) ?? .system(size: 15, weight: .medium))
                        .foregroundStyle(desktop?.ink ?? Theme.attentionText)
                        .frame(minHeight: desktop == nil ? 0 : 21.75)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail, !detail.isEmpty {
                        Text(detail)
                            .font(desktop?.font(13) ?? .system(size: 13))
                            .frame(minHeight: desktop == nil ? 0 : 17.9)
                            .foregroundStyle(desktop?.inkSecondary ?? Theme.attentionSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(answering)
        .accessibilityAddTraits(checked ? [.isSelected] : [])
    }

    private func marker(checked: Bool, multi: Bool) -> String {
        if multi { return checked ? "checkmark.square.fill" : "square" }
        return checked ? "largecircle.fill.circle" : "circle"
    }

    @ViewBuilder
    private var submit: some View {
        if let desktop {
            HStack(spacing: 12) {
                Spacer(minLength: 0)
                Label {
                    Text("Waiting for your answer")
                } icon: {
                    Image(systemName: "questionmark.bubble").foregroundStyle(desktop.accent)
                }
                .font(desktop.font(13))
                .foregroundStyle(desktop.inkSecondary)
                Button {
                    // not `.disabled`: the plain style would dim the
                    // desktop's own disabled colours
                    if complete && !answering { send() }
                } label: {
                    Text(questions.count > 1 ? "Submit answers" : "Submit answer")
                        .font(desktop.font(13.5, .medium))
                        .foregroundStyle(complete ? desktop.accentInk : desktop.inkSecondary)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(complete ? desktop.accent : desktop.raisedHover, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(complete ? [] : .isStaticText)
            }
            .padding(.top, 0)
        } else {
            phoneSubmit
        }
    }

    private var phoneSubmit: some View {
        Button {
            Haptics.selection()
            send()
        } label: {
            Text(questions.count > 1 ? "Submit answers" : "Submit answer")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(complete ? Color.white : Theme.disabledCapsuleText)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(Capsule().fill(complete ? Theme.readable(tint) : Theme.disabledCapsule))
        }
        .buttonStyle(.plain)
        .disabled(!complete || answering)
        .padding(.top, 2)
    }

    @ViewBuilder
    private func answeredSummary(_ card: OptionCard) -> some View {
        let answer = card.answeredText ?? sent
        Label {
            Text(answer.map(AskQuestionAnswer.withoutPreamble) ?? String(localized: "Answered"))
                .font(.system(size: 14))
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "checkmark.circle")
        }
        .foregroundStyle(Theme.attentionSecondary)
    }

    private func binding(forCustom position: Int) -> Binding<String> {
        Binding(get: { custom[position] ?? "" }, set: { custom[position] = $0 })
    }

    private func choose(_ label: String, in question: AskQuestion) {
        guard !settled else { return }
        var chosen = picked[index] ?? []
        if question.allowsMultiple {
            if chosen.contains(label) { chosen.remove(label) } else { chosen.insert(label) }
            picked[index] = chosen
            return
        }
        // Single-select is a radio group: picking replaces, and picking an
        // option means the free-text answer was not the one they wanted.
        picked[index] = [label]
        other.remove(index)
        otherFocused = false
        // Move to the next question they still owe an answer to. The last one
        // stays put so the submit button is under the thumb that just chose.
        if let next = questions.indices.first(where: { $0 != index && !isAnswered($0) }) {
            active = next
        }
    }

    private func toggleOther(_ question: AskQuestion) {
        guard !settled else { return }
        if other.contains(index) {
            other.remove(index)
            otherFocused = false
            return
        }
        other.insert(index)
        if !question.allowsMultiple { picked[index] = [] }
        otherFocused = true
    }

    private func send() {
        guard !settled, complete, let card, let requestId = card.requestId else { return }
        let answer = AskQuestionAnswer.format(
            questions: questions,
            answers: questions.indices.map(answers(for:))
        )
        guard !answer.isEmpty else { return }
        sent = answer
        answering = true
        otherFocused = false
        Task {
            // A question only ever answers with text; the harness rejects an
            // allow/deny on one, so this never takes the permission path.
            await session.answer(
                threadId: chat.threadId,
                requestId: requestId,
                choice: answer,
                isPermission: false
            )
            answering = false
        }
    }
}

/// The card's frame: the phone's attention card, or the desktop's.
private struct QuestionCardChrome: ViewModifier {
    @Environment(\.themePalette) var themePalette
    let desktop: DesktopTheme?
    let settled: Bool
    let tint: Color

    func body(content: Content) -> some View {
        if let desktop {
            content
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(desktop.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(settled ? desktop.hairline.opacity(0.4) : desktop.accent.opacity(0.4), lineWidth: 1)
                )
                .frame(maxWidth: 840, alignment: .leading)
        } else {
            content
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(settled ? Theme.card : Theme.attentionSurface)
                        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(settled ? Color.clear : tint.opacity(0.08)))
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(settled ? .clear : tint, lineWidth: 1.5)
                }
        }
    }
}
