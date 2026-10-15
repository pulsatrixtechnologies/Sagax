// `handOffInstall` swaps the terminal step: instead of quitting and letting
// electron-updater run the installer, the downloaded file is handed to the
// user. Ubuntu system packages use it — see electron/updater.mjs for why a
// chat app must not run dpkg itself. Everything before the install is shared.
// It receives the staged paths and resolves with an optional state patch
// describing what is left to do, which the card renders.
import { updateErrorMessage, updateErrorNeedsPerson } from "./update-errors.mjs";

// The feed's releaseNotes: a string (the latest GitHub release body) or one
// { version, note } per skipped version when fullChangelog is on. Anything
// else is dropped so the renderer only ever sees text.
export function releaseNotesFrom(info) {
  const raw = info?.releaseNotes;
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return undefined;
  const notes = [];
  for (const item of raw) {
    if (!item || typeof item.version !== "string" || !item.version.trim()) continue;
    notes.push({
      version: item.version.trim(),
      note: typeof item.note === "string" ? item.note : "",
    });
  }
  return notes;
}

/** electron-updater's release notes as one string for the renderer: the
 * GitHub provider gives the release body (HTML), a multi-release feed an
 * array of { version, note }. Capped, because it rides every state broadcast. */
export function releaseNotesText(notes) {
  const text = typeof notes === "string"
    ? notes
    : Array.isArray(notes)
      ? notes.map((entry) => (typeof entry?.note === "string" ? entry.note : "")).filter(Boolean).join("\n")
      : "";
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 8000) : undefined;
}

// GitHub's releases.atom gives each body as HTML. The release file is
// markdown, so HTML here means the feed had nothing better.
const HTML_NOTE = /<\/?(?:p|h[1-6]|ul|ol|li|strong|em|a|code|pre|br|div|blockquote)\b[^>]*>/i;

function noteFor(notes, version) {
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) return notes.find((entry) => entry.version === version)?.note ?? "";
  return "";
}

/** True when the feed brought no readable (markdown) notes for `version`. */
export function needsReleaseNotes(notes, version) {
  const note = noteFor(notes, version).trim();
  return !note || HTML_NOTE.test(note);
}

/** The feed's notes with `body` as the note of `version`. */
export function withReleaseNote(notes, version, body) {
  if (!Array.isArray(notes)) return body;
  return [{ version, note: body }, ...notes.filter((entry) => entry.version !== version)];
}

/**
 * `fetchReleaseNotes(version)` resolves the release's markdown body (or null)
 * when the feed brought none: the notes must show before every update. It is
 * asked once per version; its answer arrives as a later state patch.
 */
export function createUpdaterCoordinator(
  updater,
  setState,
  { handOffInstall = null, nativeStaging = false, fetchReleaseNotes = null } = {},
) {
  // The update the state shows, and the body the release API gave for it.
  let notesVersion = null;
  let feedNotes = undefined;
  let fetched = null;
  let notesRequest = null;

  function requestNotes(version) {
    if (notesRequest === version) return;
    notesRequest = version;
    Promise.resolve()
      .then(() => fetchReleaseNotes(version))
      .then((body) => {
        if (typeof body !== "string" || !body.trim()) return;
        fetched = { version, body };
        if (recoveryRequired || notesVersion !== version || !needsReleaseNotes(feedNotes, version)) return;
        const notes = withReleaseNote(feedNotes, version, body);
        setState({ notes, releaseNotes: releaseNotesText(notes) });
      })
      .catch(() => {
        // Notes never fail an update; the next event for it asks again.
      })
      .finally(() => {
        if (notesRequest === version) notesRequest = null;
      });
  }

  function notesOf(info) {
    let notes = releaseNotesFrom(info);
    const version = typeof info?.version === "string" ? info.version : null;
    if (version) {
      notesVersion = version;
      feedNotes = notes;
    }
    if (fetchReleaseNotes && version && needsReleaseNotes(notes, version)) {
      if (fetched?.version === version) notes = withReleaseNote(notes, version, fetched.body);
      else requestNotes(version);
    }
    return notes;
  }

  function withNotes(patch, info) {
    const notes = notesOf(info);
    if (notes === undefined) return patch;
    return "releaseNotes" in patch ? { ...patch, notes, releaseNotes: releaseNotesText(notes) } : { ...patch, notes };
  }

  let checkOperation = null;
  // Set from downloadUpdate's resolution: the paths electron-updater staged.
  // Only the hand-off needs them; quitAndInstall reads its own copy.
  let downloadedFiles = null;
  let downloadOperation = null;
  let installOperation = null;
  let nativeStagingStarted = false;
  let nativeReady = false;
  // Squirrel has no cancellation or attempt ID. After a staging failure a
  // second attempt could consume the first attempt's late ready event.
  let recoveryRequired = false;
  // A staged update, install hand-off, or failed user action remains useful
  // until the user acts again. Hourly checks must not replace its controls.
  let actionOwnsState = false;
  const routedErrors = new WeakSet();

  const routeError = (manual, error) => {
    if (recoveryRequired) return;
    // Nobody asked, and it may pass by itself (offline, a server hiccup): stay
    // quiet and let the next check try again. A failure only the person can
    // fix is shown, and waits for them instead of downloading every hour.
    const shown = manual || updateErrorNeedsPerson(error);
    actionOwnsState = shown;
    if (error instanceof Error) routedErrors.add(error);
    if (downloadOperation) {
      downloadOperation.failed = true;
      clearTimeout(downloadOperation.timer);
    }
    if (checkOperation) checkOperation.failed = true;
    if (installOperation) {
      installOperation.failed = true;
      clearTimeout(installOperation.timer);
      installOperation = null;
    }
    if (nativeStagingStarted) {
      recoveryRequired = true;
      nativeReady = false;
      setState({
        status: "error",
        retryable: false,
        message: `${updateErrorMessage(error)} Quit and reopen Sagax before trying the update again.`,
      });
      return;
    }
    if (!shown) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "error", message: updateErrorMessage(error) });
  };

  function handleRejectedOperation(manual, error) {
    if (error instanceof Error && routedErrors.has(error)) return;
    routeError(manual, error);
  }

  function checkOwnsState() {
    return !recoveryRequired && !actionOwnsState && !installOperation && !downloadOperation && !checkOperation?.supersededByDownload;
  }

  updater.on("checking-for-update", () => {
    if (checkOwnsState()) setState({ status: "checking" });
  });
  // Updates download by themselves; only the restart waits for the person.
  // This is the one place a download starts. Its failure is shown when the
  // person asked for this check, or when only they can fix it (routeError).
  updater.on("update-available", (info) => {
    if (checkOwnsState()) {
      download(Boolean(checkOperation?.manual), withNotes({
        version: info?.version,
        releaseNotes: releaseNotesText(info?.releaseNotes),
        percent: undefined,
        message: undefined,
      }, info));
    }
  });
  updater.on("update-not-available", () => {
    if (checkOwnsState()) setState({ status: "idle" });
  });
  // downloadUpdate/checkForUpdates reject after most updater errors, but the
  // macOS native staging pass used by quitAndInstall is event-only. Without
  // this listener a Squirrel.Mac failure leaves the renderer on "Restarting"
  // forever because quitAndInstall itself returns void.
  updater.on("error", (error) => {
    // Shared error events do not identify their operation. If a download
    // overtook a check, let their individual promises route failures instead.
    if (checkOperation?.supersededByDownload && !installOperation) return;
    const manual = Boolean(installOperation || downloadOperation?.manual || checkOperation?.manual || nativeStagingStarted);
    routeError(manual, error);
  });
  updater.on("download-progress", (progress) => {
    if (recoveryRequired || installOperation || nativeStagingStarted) return;
    setState({ status: "downloading", percent: Math.round(progress?.percent ?? 0) });
  });
  updater.on("update-downloaded", (info) => {
    if (recoveryRequired || installOperation) return;
    // On macOS electron-updater emits this before Squirrel.Mac has finished
    // staging the ZIP. Our vendor patch resolves downloadUpdate only on the
    // native ready event, not merely when the local ZIP transfer finishes.
    if (downloadOperation) {
      downloadOperation.downloadedInfo = info;
      if (nativeStaging && !nativeStagingStarted) {
        nativeStagingStarted = true;
        setState(withNotes({ status: "preparing", version: info?.version, message: undefined }, info));
        downloadOperation.timer = setTimeout(() => {
          updater.logger?.warn?.("Native update preparation exceeded the five-minute deadline; restart is required before retrying.");
          routeError(true, new Error("Preparing the update took too long."));
        }, 5 * 60 * 1000);
        downloadOperation.timer.unref?.();
      }
      return;
    }
    // No native attempt may become actionable from an uncorrelated late event.
    if (nativeStaging) return;
    actionOwnsState = true;
    setState(withNotes({ status: "downloaded", version: info?.version }, info));
  });

  function check(manual = false) {
    // Asking while an update downloads makes its outcome the person's to see.
    if (manual && downloadOperation) downloadOperation.manual = true;
    if (recoveryRequired || installOperation || (nativeStaging && (downloadOperation || nativeStagingStarted)) || (!manual && actionOwnsState)) return Promise.resolve();
    if (checkOperation) {
      // A manual caller upgrades the shared operation; a timer never downgrades it.
      if (manual) checkOperation.manual = true;
      return checkOperation.promise;
    }

    if (manual) actionOwnsState = false;
    const operation = { manual, supersededByDownload: Boolean(downloadOperation), failed: false, promise: null };
    checkOperation = operation;
    try {
      operation.promise = Promise.resolve(updater.checkForUpdates())
        .catch((error) => {
          if (!operation.supersededByDownload) handleRejectedOperation(operation.manual, error);
        })
        .finally(() => {
          if (checkOperation === operation) checkOperation = null;
        });
    } catch (error) {
      if (!operation.supersededByDownload) handleRejectedOperation(operation.manual, error);
      checkOperation = null;
      operation.promise = Promise.resolve();
    }
    return operation.promise;
  }

  // Only an update a check found starts here (checkOwnsState: nothing else
  // downloads, installs or awaits recovery). `manual`: the person asked
  // (their check), so a failure is theirs to see. `starting`: what the check
  // found, shown from the first "downloading".
  function download(manual, starting) {
    if (recoveryRequired || installOperation || nativeStagingStarted) return;
    if (checkOperation) checkOperation.supersededByDownload = true;

    const operation = { downloadedInfo: null, failed: false, manual, timer: null };
    downloadOperation = operation;
    // Own the state before the request goes out: the first "download-progress"
    // can be seconds away (connection setup, redirects). No percent yet — the
    // UI reads a missing percent as "starting".
    setState({ status: "downloading", ...starting });
    try {
      void Promise.resolve(updater.downloadUpdate())
        .then((result) => {
          if (!operation.failed) {
            downloadedFiles = Array.isArray(result) ? result.filter((file) => typeof file === "string") : null;
          }
          if (!operation.failed && operation.downloadedInfo) {
            nativeReady = nativeStaging;
            actionOwnsState = true;
            setState(withNotes({ status: "downloaded", version: operation.downloadedInfo?.version }, operation.downloadedInfo));
          }
        })
        .catch((error) => handleRejectedOperation(operation.manual, error))
        .finally(() => {
          clearTimeout(operation.timer);
          if (downloadOperation === operation) downloadOperation = null;
        });
    } catch (error) {
      handleRejectedOperation(operation.manual, error);
      downloadOperation = null;
    }
  }

  function install() {
    if (recoveryRequired || installOperation || downloadOperation || (nativeStaging && !nativeReady)) return;
    actionOwnsState = true;
    if (handOffInstall) {
      handOff();
      return;
    }
    const operation = { failed: false, timer: null };
    installOperation = operation;
    setState({ status: "installing" });
    try {
      updater.quitAndInstall(true, true);
    } catch (error) {
      routeError(true, error);
      return;
    }
    // quitAndInstall is void and cannot be canceled. A slow handoff must stay
    // busy: exposing Retry here used to arm another native quit callback.
    if (installOperation === operation) {
      operation.timer = setTimeout(() => {
        if (installOperation !== operation) return;
        updater.logger?.warn?.("Update restart handoff exceeded two minutes; keeping installation locked to prevent overlapping retries.");
        setState({ status: "installing", message: "Restart is taking longer than expected. Quit and reopen Sagax to finish the update." });
      }, 2 * 60 * 1000);
      operation.timer.unref?.();
    }
  }

  // The platform owns the install from here: a terminal opens with the
  // command on the clipboard and the user finishes there. No quit — the
  // running app stays usable, and the new version is picked up next launch.
  function handOff() {
    const operation = { failed: false, timer: null };
    installOperation = operation;
    setState({ status: "installing" });
    Promise.resolve()
      .then(() => handOffInstall(downloadedFiles))
      .then((patch) => {
        if (installOperation !== operation) return;
        installOperation = null;
        setState({ status: "handed-off", ...patch });
      })
      .catch((error) => {
        if (installOperation !== operation) return;
        routeError(true, error);
      });
  }

  return { check, install };
}
