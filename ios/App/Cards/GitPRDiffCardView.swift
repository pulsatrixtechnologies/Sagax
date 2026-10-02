import SwiftUI

public struct GitPRDiffCardView: View {
    @Environment(\.themePalette) var themePalette
    public let filename: String
    public let diffText: String
    public let additions: Int
    public let deletions: Int
    
    @State private var showDiff: Bool = true
    @State private var showAllLines: Bool = false

    private var lines: [String] { diffText.components(separatedBy: "\n") }
    private var visibleLines: ArraySlice<String> {
        lines.prefix(showAllLines ? lines.count : 80)
    }
    
    public init(
        filename: String = "Changes",
        diffText: String,
        additions: Int = 0,
        deletions: Int = 0
    ) {
        self.filename = filename
        self.diffText = diffText
        
        if additions == 0 && deletions == 0 {
            let lines = diffText.components(separatedBy: "\n")
            self.additions = lines.filter { $0.hasPrefix("+") && !$0.hasPrefix("+++") }.count
            self.deletions = lines.filter { $0.hasPrefix("-") && !$0.hasPrefix("---") }.count
        } else {
            self.additions = additions
            self.deletions = deletions
        }
    }
    
    public var body: some View {
        
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack(spacing: 6) {
                Image(systemName: "arrow.triangle.pull")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(Theme.success)
                
                Text(filename)
                    .font(.caption.weight(.bold))
                    .foregroundColor(Theme.textPrimary)
                    .lineLimit(1)
                
                Spacer()
                
                // Diff Delta (+ / -)
                HStack(spacing: 4) {
                    Text("+\(additions)")
                        .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.success)
                    Text("-\(deletions)")
                        .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.danger)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 2.5)
                .background(Theme.cardRaised)
                .clipShape(Capsule())
            }
            
            // Diff Content
            if !diffText.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            showDiff.toggle()
                        }
                        Haptics.selection()
                    } label: {
                        HStack {
                            Image(systemName: showDiff ? "chevron.down" : "chevron.right")
                                .font(.system(size: 9, weight: .bold))
                            Text(showDiff ? "Hide Diff" : "View Diff")
                                .font(.caption2.weight(.semibold))
                            Spacer()
                        }
                        .foregroundColor(Theme.textSecondary)
                        .padding(.vertical, 2)
                    }
                    .buttonStyle(.plain)
                    
                    if showDiff {
                        ScrollView(.horizontal, showsIndicators: false) {
                            VStack(alignment: .leading, spacing: 1) {
                                ForEach(Array(visibleLines.enumerated()), id: \.offset) { _, line in
                                    diffLineView(line)
                                }
                            }
                            .padding(6)
                        }
                        .background(Theme.inset)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .transition(.opacity.combined(with: .move(edge: .top)))

                        if lines.count > 80 {
                            Button(showAllLines ? "Show first 80 lines" : "Show all \(lines.count) lines") {
                                withAnimation(.easeInOut(duration: 0.2)) { showAllLines.toggle() }
                                Haptics.selection()
                            }
                            .font(.caption2.weight(.semibold))
                            .buttonStyle(.plain)
                            .accessibilityHint("The copied diff always includes every line")
                        }
                    }
                }
            }
            
            Theme.hairline.frame(height: 1)
            
            // Footer Actions
            HStack(spacing: 8) {
                Button {
                    PlatformBridge.copyToPasteboard(diffText)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.on.doc")
                        Text("Copy Diff")
                    }
                    .font(.caption2.weight(.medium))
                    .foregroundColor(Theme.textSecondary)
                }
                .buttonStyle(.plain)
                
                Spacer()
            }
        }
        .padding(10)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Theme.hairline, lineWidth: 0.75)
        )
        .shadow(color: Color.black.opacity(Theme.palette.isDark ? 0.20 : 0.04), radius: 4, y: 1.5)
    }
    
    @ViewBuilder
    private func diffLineView(_ line: String) -> some View {
        let isAddition = line.hasPrefix("+") && !line.hasPrefix("+++")
        let isDeletion = line.hasPrefix("-") && !line.hasPrefix("---")
        let isHeader = line.hasPrefix("@@") || line.hasPrefix("diff")
        
        Text(line)
            .font(.system(size: 10, design: .monospaced))
            .foregroundColor(
                isAddition ? Theme.success :
                isDeletion ? Theme.danger :
                isHeader ? Theme.accentText :
                Theme.textPrimary
            )
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(
                isAddition ? Theme.success.opacity(0.15) :
                isDeletion ? Theme.danger.opacity(0.15) :
                Color.clear
            )
            .clipShape(RoundedRectangle(cornerRadius: 2))
    }
}
