// The Automations page as the home presents it (matrix AU1): a long press
// on "+" > Automations opens the desktop's Automations page
// (src/components/RoutineCalendarPage.tsx RoutinesPage) in a sheet. The
// page itself is TasksRoutinesView in its Automations form, the same
// routines, logs and editor the Settings entry shows.
import SwiftUI

struct AutomationsSheet: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TasksRoutinesView(page: .automations)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(String(localized: "Done")) { dismiss() }
                            .accessibilityIdentifier("automations-done")
                    }
                }
        }
    }
}
