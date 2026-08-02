---
name: codex-luna-swarm
description: Launch and collect multiple independent gpt-5.6-luna subagents for bounded parallel work. This skill owns Luna transport even when another investigation or review skill defines the lane questions. Use whenever the user asks to launch Luna agents, a Luna swarm, many Luna lanes, or a concurrency test. For an explicit 16-50 lanes, invoke the direct launcher immediately instead of attempting native spawn_agent.
---

# Codex Luna Swarm

Launch one independent Luna worker per bounded task. Keep orchestration in the main session and
return concise lane reports without filling the main context with intermediate work.

## Act on a launch request

Start the launch in the same turn as the request. Do not stop after saying that the lanes will be
launched. Read a shared instruction packet once, resolve its path once, and pass it to the
launcher. Another skill may define the investigation, but this skill still owns how Luna runs.

Route by count:

- For 1-15 lanes, prefer native `luna_worker` agents.
- For an explicit 16-50 lanes, skip native spawning. Write one distinct task description per lane,
  then use the direct launcher with `--tasks-file` and `--stress`.
- Refuse more than 50. Do not batch the request and call it concurrent.

## Define the lanes

1. Respect the exact lane count named by the user.
2. Give every lane one concrete owned angle, a unique lowercase underscore name, exact paths or
   revision, its authority, observed facts, the reason the angle matters, and the required output.
3. Put genuinely common evidence and output rules in one shared instruction packet. Do not use the
   common packet as a substitute for explaining each lane's substantive scope.
4. Default to read-only. A write lane must own explicit paths or responsibility and must be told
   that other agents may be editing the repository.
5. Do not use a coordinator that creates more agents. Do not let a lane create another lane.

For a many-lane investigation, the main agent writes an exhaustive, self-contained explanation for
each lane. A supplied list of questions is seed material, not a ready task file. Each explanation
must include:

- the owned review angle, its boundary, and why it matters;
- the exact state or revision and the principal paths or producer -> projection -> consumer ->
  decision flows where inspection should begin;
- the minimum questions to settle, while saying they are not a ceiling on material findings inside
  the owned angle;
- a requirement to develop and test at least three plausible hypotheses, including an innocent or
  intentional explanation, rather than confirming a suggested defect;
- the expected source census: entry points, callers, tests, runtime or receipt paths, and relevant
  history where available;
- permission to report a material adjacent defect inside the owned angle, with enough evidence to
  distinguish it from duplication with another lane;
- the correction and proof contract: propose the smallest correction only for a proved defect,
  include a hostile or negative test, and state remaining uncertainty; and
- when Skills are relevant, a requirement that the lane itself selects and reads one to three of
  them before investigation. Do not assign the same generic Skills to every lane merely to satisfy
  a count.

Exhaustive briefing does not prescribe a verdict. The Luna agent still owns its hypotheses,
evidence search, and conclusion. Do not encode a preferred finding in the task.

Before launch, inspect the complete task file and regenerate weak rows. Reject a row when it is only
a title, attachment line range, restated yes/no question, or file name; when it could be completed
by inspecting one file; or when changing the lane number would make it equivalent to another row.
Confirm that every row has its own angle, starting flows, hypothesis requirement, source-census
requirement, adjacency allowance, Skill-selection rule when applicable, and proof contract.

For investigation, treat lane reports as research. Verify any finding that changes a decision
against source or receipts in the main session.

## Use native Luna agents for 1-15 lanes

For 1-15 lanes, call `spawn_agent` once per lane in one main-agent message with:

- `agent_type: "luna_worker"`;
- a unique underscore `task_name`;
- `fork_turns: "none"` when the message carries the complete packet;
- the bounded lane assignment in `message`.

Do not pass `model` or `reasoning_effort`; the installed project custom agent owns
`gpt-5.6-luna` and `max`. Do not wrap Luna in a Sol or Terra agent and do not substitute another
agent when Luna is unavailable.

Use the deterministic launcher for 1-15 lanes only when native `luna_worker` is rejected by the
active model catalogue. Report the rejection once and do not retry an unchanged error.

## Use the fallback launcher

Resolve `scripts/luna-lanes.cjs` relative to this `SKILL.md`. Do not read, copy, or reimplement the
launcher in the main session. It starts one independent `codex exec` process per lane, pins
`gpt-5.6-luna` with `max` reasoning and priority service, sends prompts over stdin without a shell,
and writes per-lane receipts.

For a read-only investigation, write a compact JSON task file. The main agent owns these
descriptions; the shared packet owns only common evidence, constraints, and output shape.

```json
[
  {
    "name": "receipts",
    "task": "Own receipt identity from creation through projection and final decision. Begin at the receipt constructors, every public projection, their consumers, the sealed runtime records, relevant tests, and recent history. Establish at least three competing explanations for any mismatch, including an intentional representation difference, and try to falsify each. The named identity questions are a minimum, not a ceiling: report material adjacent binding defects within this angle. Cite exact paths and commands. Propose the smallest owner-level correction only for a proved defect, with a hostile test and remaining uncertainty. Select and read one to three relevant repository Skills before investigating."
  },
  {
    "name": "runtime",
    "task": "Own runtime failure classification from process result through non-result typing, denominators, receipts, and downstream promotion decisions. Census entry points, callers, tests, observed runtime records, and relevant history. Form and test at least three hypotheses, including correct intentional classification. Follow material adjacent defects inside this boundary even when the starting questions omit them. Cite exact evidence and commands. For a proved defect only, propose the smallest correction plus a negative case and say what remains unproved. Select and read one to three relevant repository Skills before investigating."
  }
]
```

Launch every described lane with one command:

```sh
node .agents/skills/codex-luna-swarm/scripts/luna-lanes.cjs \
  --tasks-file /absolute/luna-tasks.json \
  --stress \
  --workdir /absolute/worktree \
  --instructions-file /absolute/shared-instructions.md
```

Each task row may be a `{ "name", "task" }` object or a task string, in which case the launcher
assigns a numbered name. Investigation rows should use named objects so the main agent can inspect
their independence before launch. Keep each task bounded but fully briefed. The tasks-file form is
read-only; use a manifest for write lanes or per-lane worktrees.

The launcher starts nested Codex CLI processes and therefore needs access to the active Codex state
directory. If the main session's shell tool is sandboxed, request one escalation for the launcher
command before starting it. This does not loosen the lane sandboxes: each read-only lane still
receives `--sandbox read-only`.

`--max-active N` queues excess work in the same launch. Stress task files use a one-second start interval;
`--start-interval-ms N` overrides it. After a typed HTTP 429 rate-limit non-result, reduce
the cap or pace and retry only missing lanes once the current launcher settles.

Each result produces one compact `luna_lane.finished` stdout event. Monitor those events and use
`--drain` for full reports; `luna_lanes.completed` and `summary.json` give the terminal counts. The
installed repo-local `Stop` hook keeps only its parent task active and wakes it once after terminal
or crash. Trust a new or changed project hook once through `/hooks`; child lanes and other task IDs
are excluded.

Select the repository's Node version in the same shell-tool call as the launcher. An exact `.nvmrc`
mismatch refuses before launch. Nested lanes inherit that executable through a private zsh startup
directory, so user startup files cannot replace the verified runtime.

Use `--count N` only for a genuine concurrency test or when the shared packet itself maps each
investigator number to a distinct assignment. It creates `luna_01` through `luna_N`; an optional
`--task-template` may use `{i}` and `{count}`. Do not use generic numbered prompts when the main
agent can state the distinct questions.

Create a compact JSON manifest:

```json
{
  "workdir": "/absolute/worktree",
  "instructionsFile": "/absolute/shared-instructions.md",
  "lanes": [
    { "name": "luna_receipts", "task": "Audit the receipt binding and return finding rows." },
    { "name": "luna_tests", "task": "Find the hostile test gap and cite exact files." }
  ]
}
```

The top-level worktree and sandbox apply to every lane unless overridden. `sandbox` defaults to
`read-only`. A `workspace-write` lane must declare non-empty `ownedPaths`. The legacy per-lane
`prompt` and `workdir` form remains accepted.

A normal manifest contains 1-15 lanes. Only when the user explicitly names 16-50 concurrent lanes,
add `"stress": true`.

Launch once:

```sh
node /absolute/skill/path/scripts/luna-lanes.cjs \
  --manifest /absolute/luna-lanes.json
```

The first output line names `outputDir` immediately. While the launcher is running, print only newly
finished reports with:

```sh
node /absolute/skill/path/scripts/luna-lanes.cjs --drain /absolute/outputDir
```

The drain cursor advances only after stdout succeeds. Repeating the same command is silent until a
new lane finishes. Call it once more after the launcher exits. Do not replace this with `find`,
`ps`, report globs, or one-file-at-a-time reads.

## Settle the result

Read `summary.json` after terminal. Require one result per requested lane and report non-zero lanes
as missing work. `reports.md` is the full combined archive; each lane also has a report, JSONL event
log, stderr log, result record, thread ID, and timing.

The launch configuration proves what was requested, not what the remote session actually bound.
When identity is load-bearing, check each thread rollout under `~/.codex/sessions/` for model,
effort, and sandbox. Keep transport fallback warnings separate from lane failure: a WebSocket to
HTTPS fallback may still end in a valid completed lane.

Return the requested synthesis, exact completed/failed counts, and any operational non-results.
