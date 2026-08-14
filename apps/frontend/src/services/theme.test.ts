import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./local-storage";
import {
  THEME_OPTIONS,
  applyTheme,
  readPreferredTheme,
  resolveTheme,
  type Theme,
} from "./theme";

/**
 * What matters about a theme is the order of precedence (§7.3, §15.2): an explicit
 * choice wins, the OS decides when there is none, and anything unrecognised counts
 * as none.
 *
 * That last rule is what keeps an older build's value harmless. This app used to
 * offer eight themes, and one of those ids still sitting in somebody's browser must
 * not select a theme whose CSS variables no longer exist — the page would paint
 * with whatever the previous theme left behind.
 *
 * The suite runs in a node environment, so `window` and `document` are faked. Only
 * the handful of members these functions touch are provided; anything else being
 * reached for should fail loudly rather than be quietly satisfied.
 */
const THEME_IDS = THEME_OPTIONS.map((option) => option.id) as Theme[];

function stubBrowser(options: { prefersLight?: boolean; stored?: string } = {}) {
  const entries = new Map<string, string>();
  if (options.stored !== undefined) entries.set(STORAGE_KEYS.theme, options.stored);

  const root = { dataset: {} as Record<string, string>, style: {} as { colorScheme?: string } };
  const found = new Map<string, { attributes: Record<string, string> }>();
  const element = (): { attributes: Record<string, string> } => ({ attributes: {} });
  found.set('meta[name="theme-color"]', element());
  found.set("#app-favicon", element());

  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string): string | null => entries.get(key) ?? null,
      setItem: (key: string, value: string): void => void entries.set(key, value),
      removeItem: (key: string): void => void entries.delete(key),
    },
    matchMedia: (query: string) => ({
      matches: query.includes("light") ? (options.prefersLight ?? false) : true,
    }),
  });
  vi.stubGlobal("document", {
    documentElement: root,
    querySelector: (selector: string) => {
      const target = found.get(selector);
      return target
        ? { setAttribute: (name: string, value: string) => void (target.attributes[name] = value) }
        : null;
    },
  });

  return { entries, root, found };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("THEME_OPTIONS", () => {
  it("offers exactly the two Brickr themes", () => {
    expect(THEME_IDS).toEqual(["brickr-dark", "brickr-light"]);
  });

  it("previews every theme with canvas, ink and accent", () => {
    for (const option of THEME_OPTIONS) {
      expect(option.swatches).toHaveLength(3);
      expect(option.swatches.every((color) => /^#[0-9a-f]{6}$/iu.test(color))).toBe(true);
    }
  });
});

describe("resolveTheme", () => {
  it("follows the OS when nothing is stored", () => {
    expect(resolveTheme(null, true)).toBe("brickr-light");
    expect(resolveTheme(null, false)).toBe("brickr-dark");
  });

  it("prefers an explicit choice over the OS setting", () => {
    expect(resolveTheme("brickr-dark", true)).toBe("brickr-dark");
    expect(resolveTheme("brickr-light", false)).toBe("brickr-light");
  });
});

describe("readPreferredTheme", () => {
  it("reads the OS preference on a first visit", () => {
    stubBrowser({ prefersLight: true });
    expect(readPreferredTheme()).toBe("brickr-light");

    stubBrowser({ prefersLight: false });
    expect(readPreferredTheme()).toBe("brickr-dark");
  });

  it("restores a stored choice against the OS setting", () => {
    stubBrowser({ prefersLight: true, stored: "brickr-dark" });
    expect(readPreferredTheme()).toBe("brickr-dark");
  });

  it("falls back to the OS for a value it does not recognise", () => {
    // What a browser carrying one of the eight retired theme ids would hold.
    stubBrowser({ prefersLight: true, stored: "github-dark" });
    expect(readPreferredTheme()).toBe("brickr-light");
  });
});

describe("applyTheme", () => {
  let browser: ReturnType<typeof stubBrowser>;

  beforeEach(() => {
    browser = stubBrowser({ prefersLight: true });
  });

  it("dresses the document and remembers the choice", () => {
    applyTheme("brickr-dark");

    expect(browser.root.dataset.theme).toBe("brickr-dark");
    // color-scheme too, or native controls and the scrollbar stay dressed for the
    // theme that was showing before.
    expect(browser.root.style.colorScheme).toBe("dark");
    expect(browser.entries.get(STORAGE_KEYS.theme)).toBe("brickr-dark");
  });

  it("survives a round trip through readPreferredTheme, for both themes", () => {
    for (const theme of THEME_IDS) {
      applyTheme(theme);
      expect(readPreferredTheme()).toBe(theme);
    }
  });

  it("switches the browser UI colour and the favicon with the theme", () => {
    applyTheme("brickr-dark");
    expect(browser.found.get('meta[name="theme-color"]')?.attributes.content).toBe("#100f13");
    expect(browser.found.get("#app-favicon")?.attributes.href).toBe("/brickr-logo-dark.svg");

    applyTheme("brickr-light");
    expect(browser.found.get('meta[name="theme-color"]')?.attributes.content).toBe("#f7f5f3");
    expect(browser.found.get("#app-favicon")?.attributes.href).toBe("/brickr-logo.svg");
  });
});
