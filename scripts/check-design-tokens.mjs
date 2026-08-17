import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import process from "node:process";

/**
 * Guards the two ways a Tailwind class silently does nothing (S1-2):
 *
 * 1. A token that isn't defined in `index.css`'s `@theme` - Tailwind v4 emits
 *    no utility for it, so the class matches no rule at all. No build, lint,
 *    or runtime error surfaces this; only a screenshot does.
 * 2. A raw Tailwind palette colour bypassing the semantic tokens entirely -
 *    not broken, but it re-introduces the drift the tokens exist to prevent
 *    and skips the per-theme contrast measurements recorded in `index.css`.
 *
 * A denylist rather than an allowlist: an allowlist of every legitimate
 * pattern (`bg-white`, `bg-black/70`, `bg-accent/15`, arbitrary-value syntax)
 * misfires constantly and stops being followed. A denylist misses whatever it
 * doesn't enumerate, but that trade is fine here since we are guarding
 * against specific known mistakes, not proving every class is a real token.
 */

const extensions = new Set([".ts", ".tsx"]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["coverage", "dist", "node_modules"].includes(entry.name)) return [];
      return walk(path);
    }
    return extensions.has(extname(entry.name)) ? [path] : [];
  });
}

const files = [...walk("apps"), ...walk("packages")];

const forbidden = [
  {
    label: "undefined design token (not in index.css's @theme)",
    pattern: /\b(?:bg|text|border|ring|from|to)-(?:error|success|info|surface-muted)\b/,
  },
  {
    label: "raw Tailwind palette colour (use a semantic token instead)",
    pattern:
      /\b(?:bg|text|border|ring|decoration|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
  },
];

const violations = [];
for (const file of files) {
  const contents = readFileSync(file, "utf8");
  for (const [index, line] of contents.split("\n").entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        violations.push(`${file}:${index + 1}: ${rule.label}: ${line.trim()}`);
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Design token violations found:\n\n${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Checked ${files.length} files: no design token violations found.\n`);
