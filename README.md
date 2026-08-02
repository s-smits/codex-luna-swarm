# Codex Luna Swarm

A repo-scoped Codex skill for launching and collecting independent `gpt-5.6-luna` workers.

While Codex is working in the repository that should receive the skill, install it first with this
request:

```text
Set up https://github.com/s-smits/codex-luna-swarm in this repository. Install or update its
repository-scoped skill, Luna agent definition, managed AGENTS.md guidance, and Stop hook. Preserve
all existing content outside its managed paths and blocks. Run the installer integrity check and
show what changed. Do not prepare or launch Luna agents in this turn.
```

After setup, start the actual Luna work in a new Codex task. The new task discovers the installed
skill, custom agent, hook, and repository guidance before it plans any lanes.

Codex should treat its current Git root as the target. It only needs another path when the current
directory is not the intended repository.

## What is installed

- `.agents/skills/codex-luna-swarm/` — the workflow and fallback launcher;
- `.codex/agents/luna_worker.toml` — the native Luna/max agent definition;
- a small managed `Stop` hook block in `.codex/config.toml`;
- a small managed block in the target repository's root `AGENTS.md`.

Nothing is added to global Codex configuration.

## Installation

The scripts support Node 20 and newer; CI covers Node 20, 22, 24 and 26.

Run one command from the target repository:

```sh
npx --yes --package 'github:s-smits/codex-luna-swarm#main' -- codex-luna-swarm --force
```

The command obtains the current `main`, installs or updates only the managed paths, and checks the
result before returning success. Do not clone this repository separately or run its upstream tests
as part of ordinary use. Show the target diff. Review and trust the project hook once through Codex
`/hooks`; Codex skips a new or changed project hook until it is trusted. A new Codex task discovers
the installed Skill, custom agent, and hook.

`--force` synchronises only the Skill-owned directory, custom-agent file, and marked blocks in
`AGENTS.md` and `.codex/config.toml`; unrelated content is preserved. The installer does not copy
environment files or configuration from another repository.

## Use

For a small collected investigation:

```text
Launch 3 Luna agents: one to inspect tests, one to inspect error handling, and one to inspect docs.
Wait for all three and summarize their evidence.
```

For a broad 50-lane launch after installation:

```text
Use $codex-luna-swarm to launch 50 independent Luna investigators for this repository. Inspect the
repository only far enough to create one shared evidence packet and exactly 50 distinct bounded
lane rows. The shared packet plus each row must be self-contained; do not repeat common context in
every row. Make each investigator exhaustive within its owned angle, expand any supplied questions
where repository evidence warrants it, and ask for proved findings with the smallest credible
correction. Keep the lanes read-only. Make reasonable assumptions and proceed through accepted
transport without stopping after a plan, task list, or command.
```

To collect and apply fixes in the same task, append: “Wait for every report, verify the
load-bearing findings, implement the confirmed fixes in the main session, run the relevant tests,
and summarise.”

Native `luna_worker` agents are preferred. If the active model catalogue rejects that agent, the
skill uses its deterministic `codex exec` fallback without substituting another model. Native work
uses up to 15 lanes; larger requests use the direct launcher, which has no lane-count ceiling.

“Launch” alone ends at the accepted start receipt. Add “wait and summarise” when the same task
should collect the reports. The main agent should say `preparing` until native calls are accepted or
the fallback emits `luna_lanes.started`; only then are the lanes `launched`.

For a shared packet and 50 distinct investigators, first write a JSON array containing one
substantive `{ "name", "task" }` brief per investigator. Shared facts belong in the common packet;
each task needs a distinct owned angle, starting point, authority, and outcome. Add competing
hypotheses and source census only for causal or defect questions. A title or line range is not a
task brief. For launch-only work, use:

```sh
node .agents/skills/codex-luna-swarm/scripts/luna-lanes.cjs \
  --tasks-file /absolute/luna-tasks.json \
  --workdir /absolute/current/git/root \
  --instructions-file /absolute/shared-instructions.md \
  --max-active 50 \
  --start-interval-ms 1000 \
  --launch-only
```

`--count 50` is reserved for an explicit rank-based concurrency test. Investigations should use
the main agent's distinct task descriptions. Validate semantic scope and JSON structure, not exact
phrases. Omit `--launch-only` when this task should wait and collect.

`--max-active` queues excess work in one launch. Lanes start one second apart by default;
`--start-interval-ms` overrides that pace. A typed HTTP 429 result means reducing the active count
or pace and retrying only missing work after the launcher settles.

Each lane prints one compact `luna_lane.finished` event; full reports remain behind `--drain`.
`luna_lanes.completed` gives terminal counts. Without `--launch-only`, the installed `Stop` hook
keeps the parent task active and wakes it once after terminal or crash. Launch-only work returns the
start receipt and leaves collection to a later request. Child lanes and other tasks are excluded.

The launcher needs access to the active Codex state directory because it starts nested Codex CLI
processes. If the main shell tool is sandboxed, grant the launcher command that access once; the
individual lane sandboxes remain read-only. Use the current compatible `node`; never assume an
`nvm` or `fnm` path merely because a repository has a runtime file.

The fallback's `--drain` command prints each newly finished report once. The main agent does not
need to read or reproduce the launcher.

## Check or remove

```sh
npx --yes --package 'github:s-smits/codex-luna-swarm#main' -- codex-luna-swarm --check
npx --yes --package 'github:s-smits/codex-luna-swarm#main' -- codex-luna-swarm --remove
```

Removal preserves unrelated `AGENTS.md` and `.codex/config.toml` content. It refuses to delete a
modified managed file or block unless `--force` is explicit.
