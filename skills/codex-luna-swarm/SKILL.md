---
name: codex-luna-swarm
description: Launch, start, monitor, and collect multiple independent gpt-5.6-luna subagents for bounded parallel work. This skill owns Luna transport even when another investigation or review skill defines the questions. Use whenever the user asks for Luna agents, a Luna swarm, many Luna lanes, a concurrency test, or later collection of Luna reports. Distinguish launch-only requests from requests to wait, collect, or synthesise. For 16 or more lanes, invoke the direct launcher instead of native spawn_agent.
---

# Codex Luna Swarm

Launch one independent Luna worker per bounded task. Keep orchestration in the main session and
keep preparation smaller than the work delegated to the lanes.

## Check required inputs first

Resolve every packet, attachment, and user-supplied path named in the current message before
browsing, installation, repository inspection, or lane planning. If a required input is absent,
ask for it immediately and stop. Do not search earlier tasks, substitute a similar file, or perform
setup while waiting.

## Interpret the requested terminal

- **Launch, start, or spawn:** accept every lane and return the launch receipt. Do not wait for
  reports unless the user also asks to wait, collect, review, or summarise.
- **Wait, collect, review, or summarise:** remain active through terminal, drain the reports, and
  return the requested synthesis.
- Treat the verb “launch” by itself as launch-only. Do not ask a clarifying question merely to add
  collection work.

Use precise states:

- `preparing` while resolving inputs, defining lanes, and checking transport;
- `launched` only after all native calls are accepted or the fallback emits
  `luna_lanes.started`;
- `collecting` only when the user requested report collection.

Do not say “launching” when only preparing a task file.

## Route by count

- For 1-15 lanes, prefer native `luna_worker` agents.
- For 16 or more lanes, use the direct launcher with `--tasks-file`.
- The direct launcher has no lane-count ceiling. Do not split one concurrency request into batches.

When native Luna availability is uncertain, attempt one prepared lane. If the active catalogue
rejects `luna_worker`, report that once and launch the complete set through the fallback. Do not try
the same rejected native call for every lane and never substitute Sol or Terra.

## Define bounded lanes

Read shared material once. Put the common revision, evidence rules, safety constraints, and output
shape in one instruction packet. A lane row then needs only:

- a unique lowercase underscore name;
- one owned question or architecture slice and its boundary;
- the principal path, entry point, or producer -> consumer flow where inspection starts;
- read-only or explicit write authority; and
- the required report or patch outcome.

For a broad request such as “investigate this repo”, inspect the top-level structure once and divide
the named count into orthogonal architecture or risk slices. Do not invent a suspected defect for
every lane and do not perform the investigation in the parent before launch.

For a causal or defect investigation, also require the lane to test at least three plausible
hypotheses when evidence suggests a mismatch, including an innocent or intentional explanation;
census the relevant callers and tests; and propose a correction only for a proved defect. Do not
force repository history, receipts, every package, or a hostile test into a lane when its question
does not need them.

If repository instructions make Skills relevant, ask the lane to select and read one to three.
Do not assign the same generic Skills to every lane only to satisfy a count.

Make each brief exhaustive inside its owned angle, not expansive across the repository. A title,
line range, generic “review this”, or duplicate numbered prompt is too weak. Validate the task file
by JSON shape, exact count, unique names, distinct scopes, starting points, authority, and outcome.
Accept equivalent wording; do not build a phrase linter.

Default to read-only. A write lane must own explicit paths or responsibility and must be told that
other agents may be editing the repository. Do not use a coordinator and do not let lanes spawn
more lanes. Treat reports as research; verify any load-bearing finding in the main session.

## Use native Luna for 1-15 lanes

Call `spawn_agent` with:

- `agent_type: "luna_worker"`;
- a unique underscore `task_name`;
- `fork_turns: "none"` when the message contains the complete evidence packet; and
- the bounded assignment in `message`.

Do not pass `model` or `reasoning_effort`; the project custom agent owns `gpt-5.6-luna` and `max`.
After the first native lane is accepted, submit the remaining prepared lanes without waiting for
that lane to finish. For launch-only work, return the accepted task IDs and stop.

## Use the fallback launcher

Resolve `scripts/luna-lanes.cjs` relative to this `SKILL.md`. Do not read, copy, or reimplement it in
the main session. It starts one independent `codex exec` process per lane, pins `gpt-5.6-luna`, max
reasoning, and priority service, sends prompts over stdin without a shell, and writes per-lane
receipts.

Use the current `node` when it satisfies the target repository and package requirements. Do not
assume `nvm`, `fnm`, or a manager path. Only when a switch is required, inspect the repository's
runtime files and discover the available manager with `type -a`; select the runtime in the same
shell call as the launcher. Do not run upstream test suites before an ordinary launch.

For a read-only investigation, write a compact JSON task file:

```json
[
  {
    "name": "receipts",
    "task": "Own receipt identity from construction through its deciding consumer. Start at the receipt constructor and public projection. Report confirmed mismatches, innocent explanations, exact evidence, and the smallest proved correction."
  },
  {
    "name": "runtime",
    "task": "Own runtime failure classification through non-result typing and denominators. Start at process result handling and its receipt consumer. Report confirmed defects, competing explanations, and remaining uncertainty."
  }
]
```

For a launch-only request, add `--launch-only`:

```sh
node .agents/skills/codex-luna-swarm/scripts/luna-lanes.cjs \
  --tasks-file /absolute/luna-tasks.json \
  --workdir /absolute/worktree \
  --instructions-file /absolute/shared-instructions.md \
  --max-active 12 \
  --start-interval-ms 1000 \
  --launch-only
```

Omit `--launch-only` when the user asked this task to collect reports. The first stdout event is
`luna_lanes.started`; only then report the output directory, exact count, model, reasoning effort,
service tier, runtime, active count, and pace as launched.

`--max-active N` queues excess work in the same launch. Lanes start one second apart by default;
`--start-interval-ms N` makes the pace explicit. After a typed HTTP 429 non-result, reduce the
active count or pace and retry only missing lanes after the current launcher settles.

The launcher needs access to active Codex state. If the parent shell is sandboxed, request access
once for the launcher command; individual read-only lane sandboxes remain read-only.

Use `--count N` only for a genuine concurrency test or when the shared packet maps each rank to a
distinct assignment. Investigations normally use named task objects.

Use a manifest for write lanes or per-lane worktrees:

```json
{
  "workdir": "/absolute/worktree",
  "instructionsFile": "/absolute/shared-instructions.md",
  "lanes": [
    { "name": "tests", "task": "Implement the named hostile test.", "sandbox": "workspace-write", "ownedPaths": ["test/"] }
  ]
}
```

A manifest contains one or more lanes. The top-level worktree and sandbox apply to every lane
unless overridden; a `workspace-write` lane requires non-empty `ownedPaths`.

## Collect only when requested

Without `--launch-only`, the repo-local Stop hook keeps the parent task active while its launcher
runs and wakes it once after terminal or crash. Child lanes and other task IDs are excluded. Trust
a new or changed project hook once through `/hooks`.

Each completion prints one compact `luna_lane.finished` event. Print every newly finished report
once with:

```sh
node .agents/skills/codex-luna-swarm/scripts/luna-lanes.cjs --drain /absolute/outputDir
```

Call `--drain` again after `luna_lanes.completed`. Then read `summary.json`, require one result per
requested lane, and report non-zero lanes as missing work. Keep transport warnings separate from
lane failure; a WebSocket-to-HTTPS fallback may still complete successfully.

The start receipt proves requested configuration, not the model actually bound by a remote
session. When identity is load-bearing, verify the session records before making the claim. Return
exact completed and failed counts plus any operational non-results.
