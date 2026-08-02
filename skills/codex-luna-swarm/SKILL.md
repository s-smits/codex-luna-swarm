---
name: codex-luna-swarm
description: Launch and collect multiple independent gpt-5.6-luna subagents for bounded parallel work. Use when the user explicitly asks for Luna agents, a Luna swarm, many parallel Luna lanes, or a concurrency test that must preserve Luna identity instead of substituting another model.
---

# Codex Luna Swarm

Launch one independent Luna worker per bounded task. Keep orchestration in the main session and
return concise lane reports without filling the main context with intermediate work.

## Define the lanes

1. Respect the exact lane count named by the user.
2. Give every lane one concrete task, a unique lowercase underscore name, exact paths or revision,
   its authority, observed facts, the question, and the required output.
3. Put shared evidence and output rules in one shared instruction packet. Keep each lane task short.
4. Default to read-only. A write lane must own explicit paths or responsibility and must be told
   that other agents may be editing the repository.
5. Do not use a coordinator that creates more agents. Do not let a lane create another lane.

For investigation, treat lane reports as research. Verify any finding that changes a decision
against source or receipts in the main session.

## Prefer native Luna agents

For 1-15 lanes, call `spawn_agent` once per lane in one main-agent message with:

- `agent_type: "luna_worker"`;
- a unique underscore `task_name`;
- `fork_turns: "none"` when the message carries the complete packet;
- the bounded lane assignment in `message`.

Do not pass `model` or `reasoning_effort`; the installed project custom agent owns
`gpt-5.6-luna` and `max`. Do not wrap Luna in a Sol or Terra agent and do not substitute another
agent when Luna is unavailable.

Use the deterministic fallback when native `luna_worker` is rejected by the active model catalogue,
or when the explicitly requested count is larger than the native session capacity. Report why the
fallback is needed. Do not spend time retrying an unchanged native rejection.

## Use the fallback launcher

Resolve `scripts/luna-lanes.cjs` relative to this `SKILL.md`. Do not read, copy, or reimplement the
launcher in the main session. It starts one independent `codex exec` process per lane, pins
`gpt-5.6-luna` with `max` reasoning and priority service, sends prompts over stdin without a shell,
and writes per-lane receipts.

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
add `"stress": true`. Refuse counts above 50 rather than silently batching them and calling the run
concurrent.

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
