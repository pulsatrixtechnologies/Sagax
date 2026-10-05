// The iPad desktop shell's Automations calendar: the desktop's week
// (src/components/RoutineCalendarPage.tsx CalendarGrid, `days` 7, weeks
// from Monday as `startOfWeek`), the hour gutter and seven columns of 64 pt
// hours with half-hour lines, each day's header (weekday 10 pt uppercase,
// the date 15 pt in a 32 pt circle, the accent on today), the events packed
// side by side per day (RoutineCalendar.day / pack), the now line; and the
// right column: the month (a graphical date picker) and My bots.
//
// The phone keeps its day agenda (AutomationsCalendarView); the rules are
// RoutineCalendar's, shared with it.
import CompanionCore
import SwiftUI

struct AutomationsWeekView: View {
    @Environment(\.themePalette) var themePalette
    @Binding var day: Date
    let routines: [Routine]
    let runs: [RoutineRun]
    let bots: [Bot]
    var botId: String?
    var loading = false
    let header: () -> AnyView
    let onCreate: (Date) -> Void
    let onAction: (AutomationsEventAction, RoutineCalendarItem) -> Void

    @State private var botQuery = ""

    private static var hourHeight: CGFloat { 64 }
    private static var gutter: CGFloat { 48 }

    /// `startOfWeek`: the Monday of the week holding `date`.
    static func weekStart(_ date: Date, calendar: Calendar = .current) -> Date {
        let start = RoutineCalendar.startOfDay(date, calendar: calendar)
        let weekday = calendar.component(.weekday, from: start) // 1 = Sunday
        return RoutineCalendar.addDays(start, -((weekday + 5) % 7), calendar: calendar)
    }

    private var weekStart: Date { Self.weekStart(day) }
    private var days: [Date] { (0..<7).map { RoutineCalendar.addDays(weekStart, $0) } }

    private var rangeLabel: String {
        let end = RoutineCalendar.addDays(weekStart, 6)
        let start = weekStart.formatted(.dateTime.month(.abbreviated).day())
        let sameMonth = Calendar.current.isDate(weekStart, equalTo: end, toGranularity: .month)
        let tail = sameMonth ? end.formatted(.dateTime.day().year()) : end.formatted(.dateTime.month(.abbreviated).day().year())
        return "\(start) – \(tail)"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                HStack(spacing: 8) { header() }
                    .frame(maxWidth: 420)
                AnyView(navigation)
                Spacer(minLength: 0)
                if loading { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
            HStack(spacing: 0) {
                AnyView(grid)
                Rectangle().fill(Theme.hairline).frame(width: 0.5)
                AnyView(side)
                    .frame(width: 280)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .accessibilityIdentifier("automations-week")
    }

    // MARK: Navigation

    private var navigation: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                Button { day = RoutineCalendar.addDays(day, -7) } label: {
                    Image(systemName: "chevron.left").frame(width: 32, height: 32)
                }
                .accessibilityLabel(Text("Previous dates"))
                Button(String(localized: "Today")) { day = RoutineCalendar.startOfDay(Date()) }
                    .font(Theme.font(12, .medium))
                    .padding(.horizontal, 10)
                Button { day = RoutineCalendar.addDays(day, 7) } label: {
                    Image(systemName: "chevron.right").frame(width: 32, height: 32)
                }
                .accessibilityLabel(Text("Next dates"))
            }
            .foregroundStyle(Theme.textPrimary)
            .padding(2)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.hairline, lineWidth: 0.5))
            Text(verbatim: rangeLabel)
                .font(Theme.font(15, .medium))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .accessibilityIdentifier("automations-range")
        }
    }

    // MARK: Grid

    private var grid: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear.frame(width: Self.gutter, height: 1)
                ForEach(days, id: \.self) { date in
                    AnyView(dayHeader(date))
                }
            }
            ScrollViewReader { reader in
                ScrollView {
                    HStack(alignment: .top, spacing: 0) {
                        hourLabels
                        ForEach(days, id: \.self) { date in
                            AnyView(column(date))
                        }
                    }
                    .frame(height: Self.hourHeight * 24)
                }
                .onAppear { scrollToStart(reader) }
                .onValueChange(of: weekStart) { _ in scrollToStart(reader) }
            }
        }
    }

    private func dayHeader(_ date: Date) -> some View {
        let today = Calendar.current.isDateInToday(date)
        return VStack(spacing: 4) {
            Text(verbatim: date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                .font(Theme.font(10, .medium))
                .tracking(1.4)
                .foregroundStyle(today ? Theme.accent : Theme.textSecondary)
            Text(verbatim: date.formatted(.dateTime.day()))
                .font(Theme.font(15, .medium))
                .foregroundStyle(today ? Color.white : Theme.textPrimary)
                .frame(width: 32, height: 32)
                .background(Circle().fill(today ? Theme.accent : Color.clear))
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(today ? Theme.accent.opacity(0.035) : Color.clear)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.hairline).frame(height: 0.5) }
        .overlay(alignment: .trailing) { Rectangle().fill(Theme.hairline).frame(width: 0.5) }
        .accessibilityElement(children: .combine)
    }

    /// As the desktop opens a grid: two hours before now in this week, else 7 AM.
    private func scrollToStart(_ reader: ScrollViewProxy) {
        let thisWeek = days.contains { Calendar.current.isDateInToday($0) }
        let hour = thisWeek ? max(0, Calendar.current.component(.hour, from: Date()) - 2) : 7
        reader.scrollTo("week-hour-\(hour)", anchor: .top)
    }

    private var hourLabels: some View {
        VStack(spacing: 0) {
            ForEach(0..<24, id: \.self) { hour in
                Text(verbatim: hour == 0 ? "" : AutomationsCalendarView<EmptyView>.hourText(hour))
                    .font(Theme.font(9.5))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: Self.gutter - 8, height: Self.hourHeight, alignment: .topTrailing)
                    .offset(y: -6)
                    .padding(.trailing, 8)
                    .id("week-hour-\(hour)")
            }
        }
        .accessibilityHidden(true)
    }

    private func column(_ date: Date) -> some View {
        let items = RoutineCalendar.day(date, routines: routines, runs: runs, botId: botId)
        let layouts = RoutineCalendar.pack(items)
        let today = Calendar.current.isDateInToday(date)
        return GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    ForEach(0..<24, id: \.self) { hour in
                        ZStack(alignment: .top) {
                            Rectangle().fill(Theme.hairline.opacity(0.75)).frame(height: 0.5)
                            Rectangle().fill(Theme.hairline.opacity(0.25)).frame(height: 0.5).offset(y: Self.hourHeight / 2)
                        }
                        .frame(maxWidth: .infinity, minHeight: Self.hourHeight, maxHeight: Self.hourHeight, alignment: .top)
                        .contentShape(Rectangle())
                        .gesture(SpatialTapGesture().onEnded { value in
                            let minutes = Double(hour) * 60 + Double(value.location.y / Self.hourHeight) * 60
                            onCreate(RoutineCalendar.slot(day: date, minutes: minutes))
                        })
                        .accessibilityElement()
                        .accessibilityLabel(Text(verbatim: "\(date.formatted(.dateTime.weekday(.wide))) \(AutomationsCalendarView<EmptyView>.hourText(hour))"))
                        .accessibilityAddTraits(.isButton)
                        .accessibilityAction { onCreate(RoutineCalendar.slot(day: date, minutes: Double(hour) * 60)) }
                    }
                }
                if today { nowLine }
                ForEach(items) { item in
                    let layout = layouts[item.id] ?? RoutineCalendarLayout(column: 0, columns: 1)
                    let width = proxy.size.width / CGFloat(layout.columns)
                    let parts = Calendar.current.dateComponents([.hour, .minute], from: item.date)
                    let top = CGFloat((parts.hour ?? 0) * 60 + (parts.minute ?? 0)) / 60 * Self.hourHeight
                    AutomationsEventCard(item: item, bot: item.botId.flatMap { id in bots.first { $0.id == id } })
                        .frame(width: max(0, width - 4), height: max(16, CGFloat(item.durationMinutes) / 60 * Self.hourHeight))
                        .offset(x: CGFloat(layout.column) * width + 2, y: top)
                        .onTapGesture { onAction(.open, item) }
                        .contextMenu { menu(item) }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .background(today ? Theme.accent.opacity(0.035) : Color.clear)
        .overlay(alignment: .trailing) { Rectangle().fill(Theme.hairline.opacity(0.5)).frame(width: 0.5) }
    }

    private var nowLine: some View {
        let now = Date()
        let minutes = Calendar.current.component(.hour, from: now) * 60 + Calendar.current.component(.minute, from: now)
        return HStack(spacing: 0) {
            Circle().fill(Theme.danger).frame(width: 8, height: 8).offset(x: -4)
            Rectangle().fill(Theme.danger.opacity(0.8)).frame(height: 1)
        }
        .offset(y: CGFloat(minutes) / 60 * Self.hourHeight - 4)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func menu(_ item: RoutineCalendarItem) -> some View {
        if item.run != nil {
            Button(String(localized: "Open run"), systemImage: "doc.text") { onAction(.open, item) }
        }
        if item.canMove {
            Button(String(localized: "Reschedule"), systemImage: "calendar.badge.clock") { onAction(.reschedule, item) }
        }
        if let routine = item.routine {
            Button(String(localized: "Edit"), systemImage: "pencil") { onAction(.edit, item) }
            Button(String(localized: "Run now"), systemImage: "play.fill") { onAction(.runNow, item) }
            if routine.canToggle() {
                Button(routine.enabled ? String(localized: "Pause") : String(localized: "Resume"),
                       systemImage: routine.enabled ? "pause" : "play") { onAction(.toggle, item) }
            }
            Button(String(localized: "Run logs"), systemImage: "list.bullet.rectangle") { onAction(.logs, item) }
        }
    }

    // MARK: Side

    private var side: some View {
        let shown = bots.filter { $0.hidden != true }
            .filter { botQuery.isEmpty || $0.name.localizedCaseInsensitiveContains(botQuery) || $0.title.localizedCaseInsensitiveContains(botQuery) }
        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                DatePicker(
                    String(localized: "Date"),
                    selection: Binding(get: { day }, set: { day = RoutineCalendar.startOfDay($0) }),
                    displayedComponents: .date
                )
                .datePickerStyle(.graphical)
                .labelsHidden()
                .tint(Theme.accent)
                .scaleEffect(0.92, anchor: .top)
                .frame(height: 300, alignment: .top)
                HStack {
                    Label(String(localized: "My bots"), systemImage: "person.2")
                        .font(Theme.font(11, .semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Text(verbatim: "\(shown.count)").font(Theme.font(10)).foregroundStyle(Theme.textSecondary)
                }
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    TextField(String(localized: "Search bots"), text: $botQuery)
                        .font(Theme.font(12))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 8)
                .frame(height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
                ForEach(shown) { bot in
                    HStack(spacing: 8) {
                        BotMascotView(bot: bot, size: 24).frame(width: 24, height: 24)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(verbatim: bot.name).font(Theme.font(12, .medium)).foregroundStyle(Theme.textPrimary).lineLimit(1)
                            if !bot.title.isEmpty {
                                Text(verbatim: bot.title).font(Theme.font(10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 2)
                }
            }
            .padding(12)
        }
    }
}
