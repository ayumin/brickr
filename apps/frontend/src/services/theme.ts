import { STORAGE_KEYS, readStoredOneOf, writeStored } from "./local-storage";

/**
 * The two themes phase 1 ships (§15.2).
 *
 * This used to be eight brand pastiches. Two is not a reduction in ambition but
 * the condition for quality: the refreshed design language leans on a surface
 * hierarchy, deliberate line weights and one accent, and every one of those has
 * to be re-judged per theme. Eight of them meant eight sets of contrast checks
 * for every new screen. Additional themes are a later-phase decision (§3).
 *
 * `swatches` are canvas / ink / accent, in that order: enough for the picker to
 * preview a theme without importing the stylesheet's values a second time.
 */
export const THEME_OPTIONS = [
  {
    id: "brickr-dark",
    label: "Brickr Dark",
    colorScheme: "dark",
    swatches: ["#100f13", "#eeebf2", "#d86a42"],
  },
  {
    id: "brickr-light",
    label: "Brickr Light",
    colorScheme: "light",
    swatches: ["#f7f5f3", "#1b1a1e", "#a9461f"],
  },
] as const;

export type Theme = (typeof THEME_OPTIONS)[number]["id"];

const THEME_IDS = THEME_OPTIONS.map((option) => option.id);

/**
 * The theme to paint on this device: the stored choice, otherwise the OS setting
 * (§7.3, §15.2).
 *
 * Order matters. A stored value wins because it is an explicit choice, and the OS
 * preference is only the starting point — but anything unrecognised is treated as
 * absent, so a value left by an older build (or by hand) falls back to the OS
 * rather than selecting a theme whose variables no longer exist.
 *
 * Dark is the default when the OS says nothing, matching the design's own centre
 * of gravity.
 */
export function readPreferredTheme(): Theme {
  return resolveTheme(
    readStoredOneOf(STORAGE_KEYS.theme, THEME_IDS),
    window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false,
  );
}

/**
 * The precedence rule on its own, with both inputs handed in.
 *
 * Split out from `readPreferredTheme` so the decision can be tested without a
 * DOM: the frontend's tests run in a node environment, and a rule this load-bearing
 * should not be verifiable only by opening a browser.
 *
 * `stored` is already validated by the caller - an unrecognised value arrives here
 * as `null`, which is why a retired theme id resolves to the OS preference.
 */
export function resolveTheme(stored: Theme | null, prefersLight: boolean): Theme {
  if (stored) return stored;
  return prefersLight ? "brickr-light" : "brickr-dark";
}

/**
 * Applies a theme to the document and remembers it.
 *
 * `data-theme` is what the stylesheet keys on; `color-scheme` is what the browser
 * keys on for form controls and the scrollbar, so both have to be set or native
 * widgets stay dressed for the previous theme.
 */
export function applyTheme(theme: Theme): void {
  const option = themeOption(theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = option.colorScheme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", option.swatches[0]);
  writeStored(STORAGE_KEYS.theme, theme);
}

function themeOption(theme: Theme): (typeof THEME_OPTIONS)[number] {
  return THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[0];
}
