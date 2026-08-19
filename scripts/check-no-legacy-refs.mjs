import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import process from "node:process";

const extensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx", ".md", ".prisma"]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["coverage", "dist", "migrations", "node_modules"].includes(entry.name)) return [];
      return walk(path);
    }
    return extensions.has(extname(entry.name)) ? [path] : [];
  });
}

const files = ["README.md", "ARCHITECTURE.md", "CONTRIBUTE.md", ...walk("apps"), ...walk("packages")];

const forbidden = [
  { label: "legacy REST endpoint", pattern: /\/api\/simulations(?:\/|\b)/ },
  { label: "legacy browser route", pattern: /["'`]\/simulations(?:\/|["'`])/ },
  { label: "legacy simulationId contract", pattern: /\bsimulationId\b/ },
  { label: "legacy Global Simulation constant", pattern: /GLOBAL_SIMULATION/ },
  { label: "legacy Global Simulation concept", pattern: /Global Simulation/i },
  { label: "removed frontend feature", pattern: /features\/simulation(?:\/|\b)/ },
  // The domain is Room everywhere: type, class, file and directory names
  // included. Only the lower-case word survives, in the reserved handle list
  // (`packages/shared/src/handle.ts`) and in product prose.
  { label: "legacy Simulation identifier", pattern: /Simulation/ },
  { label: "legacy simulation module path", pattern: /src\/simulation(?:\/|\b)/ },
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
  process.stderr.write(`Legacy Simulation references found:\n\n${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Checked ${files.length} files: no legacy Simulation references found.\n`);
