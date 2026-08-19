import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

// Collects GitLab Duo Agent Platform sessions for a period and writes the
// mechanical part of a retrospective: the metrics and the session list.
//
// The qualitative part is deliberately not generated. The value of the first
// retrospective came from cross-cutting observations ("the same curl ran about
// twenty times", "three sessions in a row looked for a template that does not
// exist") that no aggregation produces.

const TEMPLATE = "docs/duo-sessions/TEMPLATE.md";
const BEGIN = "<!-- collect:begin -->";
const END = "<!-- collect:end -->";

// Verified to exist on DuoWorkflow.
const BASE_FIELDS = [
  "id",
  "goal",
  "agentName",
  "workflowDefinition",
  "createdAt",
  "updatedAt",
  "archived",
];
// The flows API is an Experiment. Field names have already bitten us once
// (duoWorkflows vs duoWorkflowWorkflows), so anything unproven is dropped and
// the query retried rather than guessed at.
const OPTIONAL_FIELDS = ["humanStatus"];

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}

const host = (process.env.CI_SERVER_URL ?? "https://gitlab.com").replace(/\/+$/, "");
const token = process.env.DUO_RETRO_TOKEN ?? process.env.GITLAB_TOKEN;
const fullPath = arg("project", process.env.CI_PROJECT_PATH);
const daysInput = arg("days", "7");
const days = Number(daysInput);

if (!token) {
  process.stderr.write(
    "DUO_RETRO_TOKEN (or GITLAB_TOKEN) is required. It needs the api scope to read flows.\n",
  );
  process.exit(1);
}
if (!fullPath) {
  process.stderr.write("--project=<group/project> is required outside CI.\n");
  process.exit(1);
}
if (!Number.isFinite(days) || days <= 0) {
  process.stderr.write(`--days must be a positive number, got "${daysInput}".\n`);
  process.exit(1);
}

const until = new Date();
const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);

function buildQuery(fields) {
  return `query($fullPath: ID!, $after: String, $updatedAfter: ISO8601DateTime) {
  project(fullPath: $fullPath) {
    duoWorkflowWorkflows(first: 100, after: $after, updatedAfter: $updatedAfter) {
      pageInfo { hasNextPage endCursor }
      nodes { ${fields.join(" ")} }
    }
  }
}`;
}

async function graphql(query, variables) {
  const response = await fetch(`${host}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`GraphQL request failed: HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchSessions() {
  let fields = [...BASE_FIELDS, ...OPTIONAL_FIELDS];
  const nodes = [];
  let after = null;

  for (;;) {
    const payload = await graphql(buildQuery(fields), {
      fullPath,
      after,
      updatedAfter: since.toISOString(),
    });

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const unsupported = fields.filter(
        (field) =>
          OPTIONAL_FIELDS.includes(field) &&
          payload.errors.some((error) => String(error.message).includes(`'${field}'`)),
      );
      if (unsupported.length > 0) {
        process.stderr.write(
          `Dropping unsupported field(s) and retrying: ${unsupported.join(", ")}\n`,
        );
        fields = fields.filter((field) => !unsupported.includes(field));
        continue;
      }
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }

    const connection = payload.data?.project?.duoWorkflowWorkflows;
    if (!connection) {
      throw new Error(
        `No flows returned for ${fullPath}. Check that the token has the api scope and access to the project.`,
      );
    }

    nodes.push(...connection.nodes);
    if (connection.pageInfo.hasNextPage !== true) break;
    after = connection.pageInfo.endCursor;
  }

  return nodes;
}

const numericId = (gid) => /(\d+)$/.exec(String(gid ?? ""))?.[1] ?? "?";
const cell = (value) => String(value ?? "").replaceAll("|", "\\|");

function goalExcerpt(goal) {
  const text = String(goal ?? "").replace(/\s+/g, " ").trim();
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

function elapsedMinutes(session) {
  const from = Date.parse(session.createdAt);
  const to = Date.parse(session.updatedAt);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 60000));
}

function tally(sessions, pick) {
  const counts = new Map();
  for (const session of sessions) {
    const key = pick(session) ?? "(unknown)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function row(cells) {
  return `| ${cells.join(" | ")} |`;
}

function renderGenerated(sessions) {
  const elapsed = sessions.map(elapsedMinutes).filter((value) => value !== null);
  const total = elapsed.reduce((sum, value) => sum + value, 0);
  const average = elapsed.length > 0 ? `${Math.round(total / elapsed.length)} 分` : "-";
  const longest = elapsed.length > 0 ? `${Math.max(...elapsed)} 分` : "-";

  const lines = [
    BEGIN,
    "",
    "<!-- scripts/collect-duo-sessions.mjs が生成します。このブロック内を手で編集しないでください。 -->",
    "",
    "## 指標",
    "",
    row(["指標", "値"]),
    row(["------", "----"]),
    row(["セッション数", String(sessions.length)]),
    row(["平均所要時間", average]),
    row(["最大所要時間", longest]),
    row(["archived", String(sessions.filter((session) => session.archived === true).length)]),
    "",
    "種別別:",
    "",
    row(["workflowDefinition", "件数"]),
    row(["--------------------", "------"]),
    ...tally(sessions, (session) => session.workflowDefinition).map(([key, count]) =>
      row([`\`${cell(key)}\``, String(count)]),
    ),
    "",
  ];

  const statuses = tally(sessions, (session) => session.humanStatus);
  if (statuses.some(([key]) => key !== "(unknown)")) {
    lines.push(
      "状態別:",
      "",
      row(["状態", "件数"]),
      row(["------", "------"]),
      ...statuses.map(([key, count]) => row([cell(key), String(count)])),
      "",
    );
  } else {
    lines.push(
      "> 状態別の集計は取得できませんでした。",
      "> `humanStatus` がこのインスタンスの GraphQL スキーマにない可能性があります。",
      "",
    );
  }

  lines.push(
    "## セッション一覧（自動生成・全件）",
    "",
    "下の「セッション一覧」節には、この全件表から特筆すべきものだけを抜粋してください。",
    "",
    row(["Session ID", "種別", "エージェント", "状態", "所要(分)", "goal 冒頭"]),
    row(["-----------", "------", "--------------", "------", "-----------", "-----------"]),
    ...[...sessions]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map((session) => {
        const minutes = elapsedMinutes(session);
        return row([
          numericId(session.id),
          `\`${cell(session.workflowDefinition)}\``,
          cell(session.agentName ?? "-"),
          cell(session.humanStatus ?? "-"),
          minutes === null ? "-" : String(minutes),
          cell(goalExcerpt(session.goal)),
        ]);
      }),
    "",
    END,
  );

  return lines.join("\n");
}

function skeleton(date, generated) {
  // The section structure lives in TEMPLATE.md. Reading it here keeps the
  // generated file and the template from drifting apart.
  const template = readFileSync(TEMPLATE, "utf8");
  const sectionsStart = template.indexOf("\n## ");
  if (sectionsStart === -1) {
    throw new Error(`${TEMPLATE} has no "## " section to copy. Has the template changed shape?`);
  }

  return [
    `# Duo セッション振り返り: ${date}`,
    "",
    `> 対象期間: ${since.toISOString().slice(0, 10)} 〜 ${date}`,
    "",
    generated,
    template.slice(sectionsStart),
  ].join("\n");
}

const sessions = await fetchSessions();

if (sessions.length === 0) {
  process.stdout.write(`No sessions updated in the last ${days} day(s). Nothing to write.\n`);
  process.exit(0);
}

const date = until.toISOString().slice(0, 10);
const outputPath = arg("out", `docs/duo-sessions/${date}.md`);
const generated = renderGenerated(sessions);

let contents;
if (existsSync(outputPath)) {
  const existing = readFileSync(outputPath, "utf8");
  const begin = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    process.stderr.write(
      `${outputPath} exists but has no ${BEGIN} / ${END} block. Refusing to overwrite hand-written notes.\n`,
    );
    process.exit(1);
  }
  // Only the generated block is replaced, so re-running never destroys the
  // qualitative sections someone already filled in.
  contents = existing.slice(0, begin) + generated + existing.slice(end + END.length);
} else {
  contents = skeleton(date, generated);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, contents);

process.stdout.write(
  `Wrote ${sessions.length} session(s) for the last ${days} day(s) to ${outputPath}.\n`,
);
