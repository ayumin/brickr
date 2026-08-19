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
// `status` is a stable uppercase enum (FINISHED, STOPPED, ...). `humanStatus`
// was tried first and rejected: it returns localised display text, mixing
// "finished" with "実行中", so it cannot be compared safely in code.
//
// It stays in the optional list so an instance that lacks it degrades instead of
// failing outright. The flows API is an Experiment and its field names have
// already changed under us once (duoWorkflows vs duoWorkflowWorkflows).
const OPTIONAL_FIELDS = ["status"];

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}

// An exported-but-empty variable is the common failure mode here:
// `export DUO_RETRO_TOKEN="$(some command)"` where the command printed nothing.
// `??` only skips null and undefined, so the empty string would suppress the
// GITLAB_TOKEN fallback and make the diagnosis harder than it needs to be.
function env(name) {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

const host = env("CI_SERVER_URL")?.replace(/\/+$/, "") ?? "https://gitlab.com";
const token = env("DUO_RETRO_TOKEN") ?? env("GITLAB_TOKEN");
const fullPath = arg("project", env("CI_PROJECT_PATH"));
const daysInput = arg("days", "7");
const days = Number(daysInput);
const envFile = arg("env-file", null);

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

// Captured once. Everything downstream, including the values handed to CI
// through --env-file, derives from this instant so the branch name can never
// disagree with the date inside the generated file.
const until = new Date();
const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
const date = until.toISOString().slice(0, 10);
const outputPath = arg("out", `docs/duo-sessions/${date}.md`);

// 100 sessions per page. The cap only exists so a surprise in the API cannot
// turn into an unbounded paging loop.
const MAX_PAGES = 20;

function buildQuery(fields) {
  // No updatedAfter argument on purpose. The flows API is an Experiment and the
  // semantics of its filter arguments are not verified here. A server-side
  // filter that silently matches nothing is indistinguishable from "no sessions
  // this week", which is the worst way for a retrospective collector to fail.
  // The period is applied client-side instead, against a field we do read.
  return `query($fullPath: ID!, $after: String) {
  project(fullPath: $fullPath) {
    duoWorkflowWorkflows(first: 100, after: $after) {
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
  let droppedOptional = false;
  const nodes = [];
  let after = null;
  let pages = 0;

  for (;;) {
    const payload = await graphql(buildQuery(fields), { fullPath, after });

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const messages = payload.errors.map((error) => error.message).join("; ");

      // Deliberately not parsing the error text. Neither the quoting nor the
      // shape of "unknown field" errors is guaranteed, so matching on it would
      // silently disable this fallback the day the wording changes. Instead:
      // if the query fails at all while unproven fields are in it, drop all of
      // them and retry once.
      if (!droppedOptional && fields.some((field) => OPTIONAL_FIELDS.includes(field))) {
        droppedOptional = true;
        fields = fields.filter((field) => !OPTIONAL_FIELDS.includes(field));
        process.stderr.write(
          `Retrying without optional field(s) ${OPTIONAL_FIELDS.join(", ")} after: ${messages}\n`,
        );
        continue;
      }

      throw new Error(messages);
    }

    const connection = payload.data?.project?.duoWorkflowWorkflows;
    if (!connection) {
      throw new Error(
        `No flows returned for ${fullPath}. Check that the token has the api scope and access to the project.`,
      );
    }

    nodes.push(...connection.nodes);
    pages += 1;

    if (connection.pageInfo.hasNextPage !== true) break;
    if (pages >= MAX_PAGES) {
      process.stderr.write(
        `Stopped after ${MAX_PAGES} pages (${nodes.length} sessions). Raise MAX_PAGES if the window is not fully covered.\n`,
      );
      break;
    }
    after = connection.pageInfo.endCursor;
  }

  return nodes;
}

function withinWindow(session) {
  const updated = Date.parse(session.updatedAt);
  return Number.isFinite(updated) && updated >= since.getTime();
}

const numericId = (gid) => /(\d+)$/.exec(String(gid ?? ""))?.[1] ?? "?";
const cell = (value) => String(value ?? "").replaceAll("|", "\\|");

function goalExcerpt(goal) {
  const text = String(goal ?? "").replace(/\s+/g, " ").trim();
  return text.length > 70 ? `${text.slice(0, 70)}…` : text;
}

// createdAt to updatedAt, which is an upper bound on working time rather than
// working time itself: any background transition that touches the record moves
// updatedAt too. Archived sessions are excluded for that reason.
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
  const archived = sessions.filter((session) => session.archived === true);
  const elapsed = sessions
    .filter((session) => session.archived !== true)
    .map(elapsedMinutes)
    .filter((value) => value !== null);
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
    row(["archived", String(archived.length)]),
    row(["経過時間の平均", average]),
    row(["経過時間の最大", longest]),
    "",
    "> 経過時間は `createdAt` から `updatedAt` までで、**実作業時間でなく上限値**です。",
    "> 背景の状態遷移でも `updatedAt` は動くため、archived のセッションは集計から除外しています。",
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

  const statuses = tally(sessions, (session) => session.status);
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
      "> `status` がこのインスタンスの GraphQL スキーマにない可能性があります。",
      "",
    );
  }

  // A normal week produces a couple of hundred sessions. Listing all of them
  // buries the few that are worth reading, so only two slices are emitted:
  // the sessions that did not finish, and the longest ones.
  const LONGEST_COUNT = 10;

  const header = [
    row(["Session ID", "種別", "エージェント", "状態", "経過(分)", "goal 冒頭"]),
    row(["-----------", "------", "--------------", "------", "-----------", "-----------"]),
  ];
  const sessionRow = (session) => {
    const minutes = elapsedMinutes(session);
    return row([
      numericId(session.id),
      `\`${cell(session.workflowDefinition)}\``,
      cell(session.agentName ?? "-"),
      cell(session.status ?? "-"),
      minutes === null ? "-" : String(minutes),
      cell(goalExcerpt(session.goal)),
    ]);
  };
  const byElapsedDesc = (a, b) => (elapsedMinutes(b) ?? -1) - (elapsedMinutes(a) ?? -1);

  // Only treat a session as unfinished when the status is actually known.
  // Without this guard, an instance that dropped the optional `status` field
  // would flag every single session as needing review.
  const statusKnown = sessions.some(
    (session) => session.status !== undefined && session.status !== null,
  );
  // Compared case-insensitively. The enum is uppercase today, but this file
  // already survived one rename in this API and the comparison is the one place
  // where a casing change would silently mark every session as unfinished.
  const isFinished = (session) => String(session.status ?? "").toUpperCase() === "FINISHED";
  const unfinished = statusKnown
    ? [...sessions].filter((session) => !isFinished(session)).sort(byElapsedDesc)
    : [];
  const unfinishedIds = new Set(unfinished.map((session) => session.id));

  const longestSessions = [...sessions]
    .filter((session) => session.archived !== true && !unfinishedIds.has(session.id))
    .sort(byElapsedDesc)
    .slice(0, LONGEST_COUNT);

  lines.push("## 要確認セッション", "");
  if (!statusKnown) {
    lines.push(
      "> 状態が取得できなかったため抽出できません。`status` の取得可否を確認してください。",
      "",
    );
  } else if (unfinished.length === 0) {
    lines.push("この期間のセッションはすべて `FINISHED` でした。", "");
  } else {
    lines.push(
      "`FINISHED` 以外で終わったセッションです。掘る価値があるのは基本ここです。",
      "",
      ...header,
      ...unfinished.map(sessionRow),
      "",
    );
  }

  const omitted = sessions.length - unfinished.length - longestSessions.length;
  lines.push(
    `## 経過時間の長い上位 ${LONGEST_COUNT} 件`,
    "",
    ...header,
    ...longestSessions.map(sessionRow),
    "",
    `> 残る ${omitted} 件は省略しています。全件は docs/duo-sessions/README.md の GraphQL クエリで取得できます。`,
    "",
    END,
  );

  return lines.join("\n");
}

function skeleton(generated) {
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

// Hands the caller the exact date and path this run used, so a shell wrapper
// never has to recompute them and drift across a UTC midnight boundary.
function writeEnvFile(sessionCount) {
  if (envFile === null) return;
  writeFileSync(
    envFile,
    [
      `RETRO_DATE='${date}'`,
      `RETRO_OUTPUT='${outputPath}'`,
      `RETRO_SESSIONS='${sessionCount}'`,
      "",
    ].join("\n"),
  );
}

const fetched = await fetchSessions();
const sessions = fetched.filter(withinWindow);

// Both numbers are printed so that a zero result can be told apart from a
// filter that quietly dropped everything.
process.stdout.write(
  `Fetched ${fetched.length} session(s); ${sessions.length} updated within the last ${days} day(s).\n`,
);

if (sessions.length === 0) {
  writeEnvFile(0);
  process.stdout.write("Nothing to write.\n");
  process.exit(0);
}

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
  contents = skeleton(generated);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, contents);
writeEnvFile(sessions.length);

process.stdout.write(
  `Wrote ${sessions.length} session(s) for the last ${days} day(s) to ${outputPath}.\n`,
);
