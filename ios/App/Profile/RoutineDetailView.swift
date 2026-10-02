// A routine (reference 05), its instruction and the bot's instructions as a
// text card (06), and the picture framing sheet of the Character card.
//
// The routine screens use 16 pt side margins (measure-chat-profile.md §4).
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Title bar

/// Back circle and an inline 14 pt medium title 16.7 pt after it.
struct RoutineTitleBar<Trailing: View>: View {
    let title: String
    let back: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 0) {
            ProfileBackButton(action: back)
            Text(verbatim: title)
                .font(Theme.Font.bodyMedium)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.leading, 16.7)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("routine-title")
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 6)
    }
}

/// A pushed screen on the routine grid: the title bar over scrolling cards.
struct RoutineScreen<Content: View, Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0, content: content)
                    .padding(.top, 128)
                    .padding(.bottom, 40)
            }
            .ignoresSafeArea()
            ProfileTopFade().ignoresSafeArea()
            RoutineTitleBar(title: title, back: { dismiss() }, trailing: trailing)
        }
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        .background(SwipeBackBridge())
        .persistentSystemOverlays(.hidden)
        .preferredColorScheme(.dark)
    }
}

// MARK: - Routine detail (05)

struct RoutineDetailView: View {
    @State var routine: Routine
    /// The parity harness opens the instruction straight away (06).
    var showsInstruction = false
    var onChange: () async -> Void = {}

    @EnvironmentObject private var session: Session
    @State private var runs: [RoutineRun] = []
    @State private var showingInstruction = false
    @State private var editing = false
    @State private var saving = false

    private let margin = Theme.Profile.routineMargin

    var body: some View {
        RoutineScreen(title: routine.name) {
            GlassCircleButton(systemImage: "pencil", accessibilityLabel: "Edit routine", glyphSize: 17) { editing = true }
                .chatGlassRim(Circle())
                .accessibilityIdentifier("routine-edit")
        } content: {
            ProfileCard(margin: margin) {
                ProfileRow(title: Text("Active"), height: Theme.Profile.toggleRow) {
                    Toggle("", isOn: Binding(get: { routine.enabled }, set: { value in Task { await setEnabled(value) } }))
                        .labelsHidden()
                        .toggleStyle(ParityToggleStyle(width: Theme.Profile.toggle.width, height: Theme.Profile.toggle.height))
                        .padding(.trailing, Theme.Profile.textInset)
                        .disabled(saving || !routine.canToggle())
                        .accessibilityIdentifier("routine-active")
                }
                
            }

            ProfileSectionLabel(text: "Schedule", margin: margin)
                .padding(.top, Theme.Profile.cardGap)
            ProfileCard(margin: margin) {
                ProfileRow(title: Text(verbatim: RoutineWording.schedule(routine.schedule)), height: Theme.Profile.singleRow) { EmptyView() }
                    
                    .accessibilityIdentifier("routine-schedule")
                ProfileDivider(leading: Theme.Profile.textInset)
                ProfileRow(title: Text("Next run"), height: Theme.Profile.row) {
                    Text(verbatim: RoutineWording.nextRun(routine))
                        .font(Theme.Font.body)
                        .foregroundStyle(Color(hex: 0x9C9BA0))
                        .padding(.trailing, 18.7)
                        .accessibilityIdentifier("routine-next-run")
                }
                
            }

            ProfileCard(margin: margin) {
                Button {
                    Haptics.selection()
                    showingInstruction = true
                } label: {
                    ProfileRow(title: Text("Instruction"), height: Theme.Profile.singleRow) { ProfileChevronTrailing() }
                        
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("routine-instruction")
            }
            .padding(.top, Theme.Profile.cardGap)

            ProfileSectionLabel(text: "Run history", margin: margin)
                .padding(.top, Theme.Profile.cardGap)
            ProfileCard(margin: margin) {
                if runs.isEmpty {
                    ProfileRow(title: Text("No runs yet"), titleColor: Theme.textDisabled, height: Theme.Profile.singleRow)
                        
                        .accessibilityIdentifier("routine-no-runs")
                } else {
                    ForEach(Array(runs.prefix(20).enumerated()), id: \.element.id) { index, run in
                        if index > 0 { ProfileDivider(leading: Theme.Profile.textInset) }
                        RunHistoryRow(run: run)
                    }
                }
            }
        }
        .navigationDestination(isPresented: $showingInstruction) {
            TextCardView(title: String(localized: "Instruction"), text: routine.prompt)
        }
        .sheet(isPresented: $editing) {
            RoutineEditorView(routine: routine) { await reload() }
        }
        .task {
            await reload()
            if showsInstruction {
                // a push while this screen's own push still animates is dropped
                try? await Task.sleep(nanoseconds: 900_000_000)
                showingInstruction = true
            }
        }
    }

    private func setEnabled(_ enabled: Bool) async {
        saving = true
        defer { saving = false }
        if let updated = await session.setRoutineEnabled(routine, enabled: enabled) {
            routine = updated
            await onChange()
        }
    }

    private func reload() async {
        let loaded = await session.loadRoutines()
        if let fresh = loaded.routines.first(where: { $0.id == routine.id }) { routine = fresh }
        runs = loaded.runs.forRoutine(routine.id)
        await onChange()
    }
}

/// One past run: when it was due and how it went.
private struct RunHistoryRow: View {
    let run: RoutineRun

    var body: some View {
        ProfileRow(
            title: Text(Date(timeIntervalSince1970: (run.startedAt ?? run.scheduledFor) / 1_000).formatted(date: .abbreviated, time: .shortened)),
            height: Theme.Profile.row
        ) {
            Text(verbatim: status)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textSecondary)
                .padding(.trailing, 18.7)
        }
        
        .accessibilityIdentifier("routine-run.\(run.id)")
    }

    private var status: String {
        switch run.status {
        case "completed": String(localized: "Completed")
        case "running": String(localized: "Running")
        case "waiting": String(localized: "Waiting")
        case "failed": String(localized: "Failed")
        case "missed": String(localized: "Missed")
        case "cancelled": String(localized: "Cancelled")
        default: run.status.capitalized
        }
    }
}

// MARK: - Text card (06)

/// A long text in one card: 14 pt on the chat's 18.1 pt pitch, 18 pt in.
struct TextCardBody: View {
    let text: String

    var body: some View {
        ProfileCard(margin: Theme.Profile.routineMargin) {
            Text(verbatim: text)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textPrimary)
                .lineSpacing(Theme.bodyLineSpacing)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 18.7)
                .padding(.top, 14.6)
                .padding(.bottom, 14.6)
                .accessibilityIdentifier("text-card-body")
        }
    }
}

struct TextCardView: View {
    let title: String
    let text: String

    var body: some View {
        RoutineScreen(title: title) { EmptyView() } content: {
            TextCardBody(text: text)
        }
    }
}

// MARK: - The bot's instructions (03 > Instructions)

/// The soul, read from the server; the owner or an admin edits it in place.
struct InstructionView: View {
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var soul: String?
    @State private var problem: String?
    @State private var editing = false
    @State private var draft = ""
    @State private var saving = false
    @FocusState private var focused: Bool

    var body: some View {
        RoutineScreen(title: String(localized: "Instructions")) {
            if editing {
                HStack(spacing: Theme.Metric.controlGap) {
                    GlassCircleButton(systemImage: "xmark", accessibilityLabel: "Cancel", glyphSize: 16) {
                        editing = false
                    }
                    .chatGlassRim(Circle())
                    .accessibilityIdentifier("instructions-cancel")
                    GlassCircleButton(systemImage: "checkmark", accessibilityLabel: "Save", glyphSize: 17) {
                        Task { await save() }
                    }
                    .chatGlassRim(Circle())
                    .disabled(saving)
                    .accessibilityIdentifier("instructions-save")
                }
            } else if soul != nil {
                GlassCircleButton(systemImage: "pencil", accessibilityLabel: "Edit", glyphSize: 17) {
                    draft = soul ?? ""
                    editing = true
                    focused = true
                }
                .chatGlassRim(Circle())
                .accessibilityIdentifier("instructions-edit")
            }
        } content: {
            if editing {
                ProfileCard(margin: Theme.Profile.routineMargin) {
                    TextEditor(text: $draft)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .scrollContentBackground(.hidden)
                        .focused($focused)
                        .frame(minHeight: 320)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .accessibilityIdentifier("instructions-editor")
                }
            } else if let soul {
                TextCardBody(text: soul.isEmpty ? String(localized: "No instructions yet.") : soul)
            } else if let problem {
                TextCardBody(text: problem)
            } else {
                ProgressView().padding(.top, 40)
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do { soul = try await client.soul(botId: bot.id).soul } catch { problem = error.localizedDescription }
    }

    private func save() async {
        guard let client = session.profileClient else { return }
        saving = true
        defer { saving = false }
        do {
            let updated = try await client.saveSoul(botId: bot.id, soul: draft)
            session.applyProfileBot(updated)
            soul = draft
            editing = false
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}

// MARK: - Picture framing

/// Pinch to zoom and drag to move the picture in its frame; saved as
/// `avatarZoom` and `avatarFocusX/Y`.
struct PictureFramingSheet: View {
    let bot: Bot
    let save: (Double, Double, Double) -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var zoom: Double
    @State private var focusX: Double
    @State private var focusY: Double
    @State private var startZoom: Double?
    @State private var startFocus: (Double, Double)?

    private let box: CGFloat = 240

    init(bot: Bot, save: @escaping (Double, Double, Double) -> Void) {
        self.bot = bot
        self.save = save
        let framing = bot.framing
        _zoom = State(initialValue: framing.zoom)
        _focusX = State(initialValue: framing.focusX)
        _focusY = State(initialValue: framing.focusY)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                ZStack {
                    if let image {
                        FramedPicture(
                            image: image, size: box,
                            crop: bot.avatarCrop.flatMap { $0 == .mascot ? nil : $0 } ?? .circle,
                            zoom: zoom, focusX: focusX, focusY: focusY
                        )
                    } else {
                        ProgressView()
                    }
                }
                .frame(width: box, height: box)
                .contentShape(Rectangle())
                .gesture(drag.simultaneously(with: pinch))
                .accessibilityIdentifier("framing-picture")
                Text("Pinch to zoom, drag to move.")
                    .font(Theme.Font.profileLabel)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
            }
            .frame(maxWidth: .infinity)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(Text("Frame picture"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Save")) {
                        save(zoom, focusX, focusY)
                        dismiss()
                    }
                    .accessibilityIdentifier("framing-save")
                }
            }
        }
        .preferredColorScheme(.dark)
        .task {
            if let data = await session.avatarData(for: bot) { image = UIImage(data: data) }
        }
    }

    private var pinch: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                let start = startZoom ?? zoom
                startZoom = start
                zoom = min(3, max(1, start * value))
            }
            .onEnded { _ in startZoom = nil }
    }

    private var drag: some Gesture {
        DragGesture()
            .onChanged { value in
                let start = startFocus ?? (focusX, focusY)
                startFocus = start
                // moving the picture right shows more of its left side
                let scale = Double(box) * zoom
                focusX = min(1, max(0, start.0 - value.translation.width / scale))
                focusY = min(1, max(0, start.1 - value.translation.height / scale))
            }
            .onEnded { _ in startFocus = nil }
    }
}
