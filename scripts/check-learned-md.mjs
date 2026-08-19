import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

// LEARNED.md is written by agents and read by agents. Nothing else enforces its
// own rules, so a bad entry becomes a permanent instruction. These checks cover
// the parts of those rules that are mechanically verifiable.

const LEARNED = "LEARNED.md";
const AGENTS = "AGENTS.md";

const MAX_ITEMS = 10;
const KEEP_SECTION = "\u7d99\u7d9a\u3059\u3079\u304d\u3053\u3068\uff08Keep\uff09";
const PROBLEM_SECTION = "\u6539\u5584\u3059\u3079\u304d\u3053\u3068\uff08Problem\uff09";

const REQUIRED_SECTIONS = [
  "\u3053\u306e\u30d5\u30a1\u30a4\u30eb\u306e\u4f4d\u7f6e\u3065\u3051",
  "\u66f4\u65b0\u30eb\u30fc\u30eb",
  KEEP_SECTION,
  PROBLEM_SECTION,
  "\u6b21\u306b\u30c8\u30e9\u30a4\u3059\u308b\u3053\u3068\uff08Try\uff09",
  "\u305d\u306e\u4ed6\u306e\u6ce8\u91c8\uff08Notes\uff09",
  "\u66f4\u65b0\u5c65\u6b74",
];

const EVIDENCE_LABEL = "- **\u6839\u62e0**";
const RECURRENCE_LABEL = "- **\u518d\u51fa\u73fe**";
const EXCEPTION_LABEL = "- **\u5099\u8003**";

const SESSION_ID = /session\s+\d+/;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
// "1 \u30bb\u30c3\u30b7\u30e7\u30f3" but not "11 \u30bb\u30c3\u30b7\u30e7\u30f3".
const SINGLE_SESSION = /(?:^|[^0-9])1\s*\u30bb\u30c3\u30b7\u30e7\u30f3/;

for (const path of [LEARNED, AGENTS]) {
  if (!existsSync(path)) {
    process.stderr.write(`${path} is missing. It is part of the agent instruction set.\n`);
    process.exit(1);
  }
}

const violations = [];
const sections = new Set();
const items = [];

let section = null;
let current = null;

for (const [index, rawLine] of readFileSync(LEARNED, "utf8").split("\n").entries()) {
  const line = rawLine.trim();
  const lineNumber = index + 1;

  if (line.startsWith("### ")) {
    const item = /^###\s+([KP])(\d+)\.\s*(.+)$/.exec(line);
    current = item
      ? { prefix: item[1], id: `${item[1]}${item[2]}`, title: item[3], section, lineNumber, body: [] }
      : null;
    if (current) items.push(current);
    continue;
  }

  if (line.startsWith("## ")) {
    section = line.slice(3).trim();
    sections.add(section);
    current = null;
    continue;
  }

  if (current) current.body.push(line);
}

for (const name of REQUIRED_SECTIONS) {
  if (!sections.has(name)) {
    violations.push(`${LEARNED}: required section is missing: "## ${name}"`);
  }
}

const firstSeenAt = new Map();
const counts = new Map([
  [KEEP_SECTION, 0],
  [PROBLEM_SECTION, 0],
]);

for (const item of items) {
  const at = `${LEARNED}:${item.lineNumber}: ${item.id}`;

  if (firstSeenAt.has(item.id)) {
    violations.push(`${at}: duplicate item id (first seen on line ${firstSeenAt.get(item.id)})`);
  } else {
    firstSeenAt.set(item.id, item.lineNumber);
  }

  const expected = item.prefix === "K" ? KEEP_SECTION : PROBLEM_SECTION;
  if (item.section === expected) {
    counts.set(expected, counts.get(expected) + 1);
  } else {
    violations.push(
      `${at}: must live under "## ${expected}" but was found under "## ${item.section ?? "(no section)"}"`,
    );
  }

  const evidence = item.body.find((line) => line.startsWith(EVIDENCE_LABEL));
  if (evidence === undefined) {
    violations.push(`${at}: rule 1: no "${EVIDENCE_LABEL}:" line`);
  } else {
    if (!SESSION_ID.test(evidence)) {
      violations.push(
        `${at}: rule 1: evidence must cite a session id such as "session 6422073". ` +
          "MR and issue numbers are supporting information, not evidence.",
      );
    }
    if (!ISO_DATE.test(evidence)) {
      violations.push(`${at}: rule 1: evidence must cite a YYYY-MM-DD date`);
    }
  }

  const recurrence = item.body.find((line) => line.startsWith(RECURRENCE_LABEL));
  if (recurrence === undefined) {
    violations.push(`${at}: rule 2: no "${RECURRENCE_LABEL}:" line`);
  } else if (
    SINGLE_SESSION.test(recurrence) &&
    !item.body.some((line) => line.startsWith(EXCEPTION_LABEL))
  ) {
    violations.push(
      `${at}: rule 2: a single-session item needs a "${EXCEPTION_LABEL}:" line stating why it is ` +
        "an exception (session stopped or failed). Otherwise move it to the Notes section.",
    );
  }
}

for (const [name, count] of counts) {
  if (count > MAX_ITEMS) {
    violations.push(
      `${LEARNED}: rule 3: "## ${name}" holds ${count} items (max ${MAX_ITEMS}). ` +
        "Merge or drop an existing item instead of adding one.",
    );
  }
}

// AGENTS.md summarises a few items by id instead of copying their text. If an id
// disappears from LEARNED.md the summary silently becomes a second, stale source
// of truth, which is exactly what the cross-reference was meant to prevent.
const declared = new Set(items.map((item) => item.id));
for (const [, id] of readFileSync(AGENTS, "utf8").matchAll(/\b([KP]\d+)\b/g)) {
  if (!declared.has(id)) {
    violations.push(`${AGENTS}: references ${id}, which no longer exists in ${LEARNED}`);
  }
}

if (violations.length > 0) {
  process.stderr.write(`${LEARNED} rule violations found:\n\n${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(
  `Checked ${items.length} ${LEARNED} items and ${AGENTS} cross-references: all rules satisfied.\n`,
);
