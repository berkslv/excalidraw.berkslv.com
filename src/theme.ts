// Colors from the berkslv design system (tokens.json, dark theme only).
export const BRAND = {
  background: "#05090a",
  text: "#ffffff",
  accent: "#61f3b0",
} as const;

/** Background for drawings that have not saved one yet. */
export const DEFAULT_CANVAS_BACKGROUND = BRAND.background;

/**
 * Tool defaults applied every time a drawing opens. Excalidraw does not store
 * these with the scene, so without this each session would start in black ink,
 * which is invisible on the dark canvas.
 */
export const TOOL_DEFAULTS = {
  currentItemStrokeColor: BRAND.text,
  currentItemBackgroundColor: "transparent",
  // The canvas already shows true colors; exporting "in dark mode" would invert them.
  exportWithDarkMode: false,
} as const;
