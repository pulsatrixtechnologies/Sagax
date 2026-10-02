import SwiftUI
import CompanionCore

public struct AgentThoughtChamberView: View {
    @Environment(\.themePalette) var themePalette
    public let reasoning: String
    public let botName: String
    public let mascotColor: Color
    public let isStreaming: Bool
    
    @State private var isExpanded: Bool = false
    
    public init(
        reasoning: String,
        botName: String = "Bot",
        mascotColor: Color = .purple,
        isStreaming: Bool = false
    ) {
        self.reasoning = reasoning
        self.botName = botName
        self.mascotColor = mascotColor
        self.isStreaming = isStreaming
    }
    
    public var body: some View {
        let isDark = Theme.palette.isDark
        let window = ReasoningWindow(reasoning)
        
        VStack(alignment: .leading, spacing: 6) {
            headerButton(isDark: isDark, total: window.total)
            
            if isExpanded {
                expandedContent(isDark: isDark, steps: window.steps)
            }
        }
        .padding(6)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(isDark ? mascotColor.opacity(0.3) : Theme.hairline, lineWidth: 0.65)
        )
        .shadow(color: Color.black.opacity(isDark ? 0.25 : 0.04), radius: 3, y: 1)
    }
    
    @ViewBuilder
    private func headerButton(isDark: Bool, total: Int) -> some View {
        Button {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.72)) {
                isExpanded.toggle()
            }
            Haptics.selection()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(mascotColor)
                
                Text(isStreaming ? "Thinking…" : "Thought Process")
                    .font(.caption2.weight(.bold))
                    .foregroundColor(Theme.textPrimary)
                
                if isStreaming {
                    Circle()
                        .fill(mascotColor)
                        .frame(width: 6, height: 6)
                        .pulseCompat(isActive: isStreaming)
                }
                
                Spacer()
                
                Text("\(total) \(total == 1 ? "step" : "steps")")
                    .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                    .foregroundColor(Theme.textSecondary)
                
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(Theme.textSecondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Theme.cardRaised)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
    
    @ViewBuilder
    private func expandedContent(isDark: Bool, steps: [ReasoningWindow.Step]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(steps) { step in
                            stepRow(number: step.number, step: step.text, isDark: isDark)
                        }
                    }
                }
                .frame(maxHeight: 160)
                // While the bot thinks, the newest step is the news: start at
                // the bottom and keep following as steps arrive, the way the
                // reply bubble follows its own text.
                .scrollAnchorCompat(.bottom)
                .onValueChange(of: reasoning) { _ in
                    guard isStreaming, let newest = steps.last else { return }
                    withAnimation { proxy.scrollTo(newest.number, anchor: .bottom) }
                }
            }
        }
        .padding(10)
        .background(Theme.inset)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 0.5)
        )
        .transition(.opacity.combined(with: .move(edge: .top)))
    }
    
    @ViewBuilder
    private func stepRow(number: Int, step: String, isDark: Bool) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(String(number) + ".")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(mascotColor)
            
            Text(step)
                .font(.caption2)
                .foregroundColor(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
