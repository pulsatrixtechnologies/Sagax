// The name people see. The runtime app name (app.name, "openmausbot") is
// deliberately different: it names the data folder and the keychain secret,
// so it never changes (user-data-location.mjs). Everything on screen that
// Electron would otherwise label with app.name (the macOS app menu's About,
// Hide and Quit, the About panel) takes these instead.
export const DISPLAY_NAME = "Sagax";
/** The full brand, beside Pulsatrix Perspicax: About, installer shortcuts. */
export const FULL_NAME = "Pulsatrix Sagax";
