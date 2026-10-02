// The app's mascot vocabulary: the desktop engine's states (`MAUS_STATES` in
// `src/lib/mascot.ts`) under their stored names. The characters read them
// through `owlState`, `shapeMood` and `trombiPose` (MascotPaint.swift);
// which one a bot wears right now is `MausState.forBot` (MascotState.swift).
enum MausState: String, CaseIterable {
    /// States whose motion carries information — a turn in progress. Faces in
    /// lists animate only for these; a resting bot earns a resting face.
    var showsActivity: Bool {
        switch self {
        case .listening, .thinking, .searching, .working: return true
        default: return false
        }
    }

    case sleeping = "sleeping"
    case waking = "waking"
    case idle = "idle"
    case listening = "listening"
    case thinking = "thinking"
    case searching = "searching"
    case working = "working"
    case excited = "excited"
    case surprised = "surprised"
    case suspicious = "suspicious"
    case angry = "angry"
    case drowsy = "drowsy"
    case happy = "happy"
    case curious = "curious"
    case confused = "confused"
    case bored = "bored"
    case proud = "proud"
    case shy = "shy"
    case sad = "sad"
    case laughing = "laughing"
    case scared = "scared"
    case playful = "playful"
    case celebrate = "celebrate"
    case orbit = "orbit"
    case radar = "radar"
    case progress = "progress"
    case thinkingDots = "thinking-dots"
    case spawning = "spawning"
    case humming = "humming"
    case loading = "loading"
    case dictating = "dictating"
    case sending = "sending"
    case receiving = "receiving"
    case uploading = "uploading"
    case writing = "writing"
    case notifying = "notifying"
    case alerting = "alerting"
    case bouncing = "bouncing"
    case dragging = "dragging"
    case poweringDown = "powering-down"
}
