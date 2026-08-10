export const THEME_OPTIONS = [
  {
    id: "x-light",
    label: "X.com (Light)",
    colorScheme: "light",
    swatches: ["#ffffff", "#0f1419", "#1d9bf0"],
  },
  {
    id: "x-dark",
    label: "X.com (Dark)",
    colorScheme: "dark",
    swatches: ["#000000", "#e7e9ea", "#1d9bf0"],
  },
  {
    id: "salesforce",
    label: "Salesforce",
    colorScheme: "light",
    swatches: ["#f3f3f3", "#181818", "#0b5cab"],
  },
  {
    id: "atlassian",
    label: "Atlassian",
    colorScheme: "light",
    swatches: ["#f7f8f9", "#172b4d", "#0c66e4"],
  },
  {
    id: "gitlab-light",
    label: "GitLab (Light)",
    colorScheme: "light",
    swatches: ["#ffffff", "#1f1e24", "#fc6d26"],
  },
  {
    id: "gitlab-dark",
    label: "GitLab (Dark)",
    colorScheme: "dark",
    swatches: ["#171321", "#fbfafd", "#fc6d26"],
  },
  {
    id: "github-light",
    label: "GitHub (Light)",
    colorScheme: "light",
    swatches: ["#ffffff", "#1f2328", "#0969da"],
  },
  {
    id: "github-dark",
    label: "GitHub (Dark)",
    colorScheme: "dark",
    swatches: ["#0d1117", "#f0f6fc", "#58a6ff"],
  },
] as const;

export type Theme = (typeof THEME_OPTIONS)[number]["id"];

const THEME_STORAGE_KEY = "enjo.theme";

export function readPreferredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
    // Migrate the original two-value setting without changing its appearance.
    if (stored === "light") return "x-light";
    if (stored === "dark") return "x-dark";
  } catch {
    // Storage can be blocked; the system preference is still usable.
  }

  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "x-light"
    : "x-dark";
}

export function applyTheme(theme: Theme): void {
  const option = themeOption(theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = option.colorScheme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", option.swatches[0]);
  document
    .querySelector('#app-favicon')
    ?.setAttribute(
      "href",
      option.colorScheme === "dark"
        ? "/brickr-logo-dark.svg"
        : "/brickr-logo.svg",
    );
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme switching still works for the current page without persistence.
  }
}

function isTheme(value: string | null): value is Theme {
  return THEME_OPTIONS.some((option) => option.id === value);
}

function themeOption(theme: Theme): (typeof THEME_OPTIONS)[number] {
  return THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[0];
}
