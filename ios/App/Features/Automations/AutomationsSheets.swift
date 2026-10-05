// The Automations calendar's two sheets (matrix AU3, AU4):
//
// - New calendar event: the desktop's QuickComposer
//   (src/components/RoutineCalendarPage.tsx) for a slot: title, the slot's
//   date and time, a bot, what it should do; Save creates a one-time routine
//   there (`POST /api/routines`, RoutineInput.calendarSlot), More options
//   opens the full editor with what was typed.
// - Reschedule: the phone's stand-in for dragging an event to another slot.
//   It sends what the drop sends (`moveEvent`: `PATCH /api/routines/:id`
//   with the moved schedule alone) and asks first for a recurring series.
import CompanionCore
import SwiftUI

/// A slot to create in (`EventSeed`).
struct AutomationsSlot: Identifiable, Hashable {
    var at: Date
    var botId: String?
    var id: Double { at.timeIntervalSince1970 }
}

struct AutomationsQuickCreateSheet: View {
    @Environment(\.themePalette) var themePalette
    let slot: AutomationsSlot
    let onSaved: () async -> Void
    /// "More options": the full editor, seeded.
    let onMore: (RoutineEditorSeed) -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var prompt = ""
    @State private var botId = ""
    @State private var saving = false
    @FocusState private var titleFocused: Bool

    private var bots: [Bot] { session.state.bots.filter { $0.hidden != true } }
    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !botId.isEmpty
            && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            ThemedForm {
                Section {
                    TextField(String(localized: "Add title"), text: $name)
                        .font(Theme.font(18, .medium))
                        .focused($titleFocused)
                        .submitLabel(.done)
                        .onSubmit { if valid { Task { await save() } } }
                        .accessibilityIdentifier("automations-quick-title")
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: slot.at.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                            Text(verbatim: slot.at.formatted(date: .omitted, time: .shortened))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    } icon: {
                        Image(systemName: "clock")
                    }
                    .accessibilityIdentifier("automations-quick-time")
                }
                Section {
                    if bots.isEmpty {
                        Text("Create your first bot. Then come back to schedule it.")
                            .foregroundStyle(Theme.textSecondary)
                    } else {
                        Picker(selection: $botId) {
                            Text("Assign a bot").tag("")
                            ForEach(bots) { bot in Text(verbatim: bot.name).tag(bot.id) }
                        } label: {
                            Label(String(localized: "Bot"), systemImage: "person.crop.circle.badge.plus")
                        }
                        .accessibilityIdentifier("automations-quick-bot")
                    }
                    TextField(String(localized: "What should the bot do?"), text: $prompt, axis: .vertical)
                        .lineLimit(3...8)
                        .accessibilityIdentifier("automations-quick-prompt")
                }
                Section {
                    Button(String(localized: "More options")) {
                        onMore(RoutineEditorSeed(at: slot.at, name: name, prompt: prompt, botId: botId.isEmpty ? nil : botId))
                    }
                    .accessibilityHint(Text("Choose repeating schedules and other options"))
                    .accessibilityIdentifier("automations-quick-more")
                }
            }
            .navigationTitle(Text("New calendar event"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Save")) { Task { await save() } }
                        .disabled(!valid || saving)
                        .accessibilityIdentifier("automations-quick-save")
                }
            }
            .onAppear {
                if botId.isEmpty { botId = slot.botId ?? bots.first?.id ?? "" }
                titleFocused = true
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let input = RoutineInput.calendarSlot(name: name, prompt: prompt, botId: botId, at: slot.at)
        guard await session.saveRoutine(input, original: nil) != nil else { return }
        await onSaved()
        dismiss()
    }
}

struct AutomationsRescheduleSheet: View {
    @Environment(\.themePalette) var themePalette
    let item: RoutineCalendarItem
    let onSaved: () async -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var at: Date
    @State private var confirmingSeries = false
    @State private var saving = false

    init(item: RoutineCalendarItem, onSaved: @escaping () async -> Void) {
        self.item = item
        self.onSaved = onSaved
        _at = State(initialValue: item.date)
    }

    var body: some View {
        NavigationStack {
            ThemedForm {
                Section {
                    Text(verbatim: item.name).font(.headline)
                    LabeledContent(String(localized: "Now"), value: item.date.formatted(date: .abbreviated, time: .shortened))
                } footer: {
                    if item.recurring {
                        Text("Moving this occurrence moves the entire recurring series.")
                    }
                }
                Section {
                    DatePicker(String(localized: "Starts"), selection: $at, displayedComponents: [.date, .hourAndMinute])
                        .datePickerStyle(.graphical)
                        .tint(Theme.accent)
                        .accessibilityIdentifier("automations-reschedule-date")
                }
            }
            .navigationTitle(Text("Reschedule"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Save")) {
                        if item.recurring { confirmingSeries = true } else { Task { await save() } }
                    }
                    .disabled(saving || moved == item.date)
                    .accessibilityIdentifier("automations-reschedule-save")
                }
            }
            .confirmationDialog(
                String(localized: "Move this entire recurring series?"),
                isPresented: $confirmingSeries,
                titleVisibility: .visible
            ) {
                Button(String(localized: "Move series")) { Task { await save() } }
                    .accessibilityIdentifier("automations-reschedule-series")
            }
        }
    }

    /// The chosen minute (the picker keeps the seconds of the start).
    private var moved: Date {
        let calendar = Calendar.current
        var parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: at)
        parts.second = 0
        return calendar.date(from: parts) ?? at
    }

    private func save() async {
        guard let routine = item.routine else { return }
        saving = true
        defer { saving = false }
        let schedule: RoutineSchedule
        do {
            schedule = try RoutineCalendar.schedule(routine.schedule, movingOccurrence: item.date, to: moved)
        } catch {
            session.actionError = String(localized: "Open this routine to edit its repeating schedule and time zone.")
            return
        }
        guard await session.saveRoutine(.rescheduling(routine, to: schedule), original: routine) != nil else { return }
        await onSaved()
        dismiss()
    }
}
