/**
 * Windows hides the native title bar entirely: titleBarStyle "hidden" without
 * a titleBarOverlay removes the caption buttons too, so the renderer draws
 * them (WindowCaptionButtons.tsx) with the app's own colors and hover states.
 * The WCO overlay API cannot style hover, which is why it is not used.
 */
export const TRAFFIC_LIGHTS = Object.freeze({ x: 16, y: 16 });
/** Hibou 98 draws a 28px navy title bar across the top; the lights sit inside it. */
export const RETRO_TRAFFIC_LIGHTS = Object.freeze({ x: 10, y: 7 });

export function windowChromeOptions(platform) {
  if (platform === "darwin") {
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { ...TRAFFIC_LIGHTS } };
  }
  if (platform === "win32") {
    return { titleBarStyle: "hidden" };
  }
  return {};
}

/** Where the macOS traffic lights go for a skin; null off macOS (nothing to move). */
export function trafficLightsForSkin(platform, skin) {
  if (platform !== "darwin") return null;
  return { ...(skin === "retro98" ? RETRO_TRAFFIC_LIGHTS : TRAFFIC_LIGHTS) };
}
