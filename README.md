# Codex Luna Swarm

A repo-scoped Codex skill for launching and collecting independent `gpt-5.6-luna` workers.

While Codex is working in the repository that should receive the skill, give it this repository
URL together with the work to run:

```text
Use https://github.com/s-smits/codex-luna-swarm in this repository and launch 50 Luna investigators
from the attached shared instruction packet. Before launch, write an exhaustive, self-contained
brief for each investigator. The supplied questions are starting points, not the complete scope.
The attachment in this message is required. If it is absent, ask for it immediately and do nothing
else.
```

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

Before setup, resolve every attachment or path named by the user from the current message. If a
required input is absent, ask for it immediately. Do not browse, install, inspect the repository,
or search other tasks first.

Then run one command from the target repository:

```sh
npx --yes --package 'github:s-smits/codex-luna-swarm#main' -- codex-luna-swarm --force
```

The command obtains the current `main`, installs or updates only the managed paths, and checks the
result before returning success. Do not clone this repository separately or run its upstream tests
as part of ordinary use. Show the target diff. Review and trust the project hook once through Codex
`/hooks`; Codex skips a new or changed project hook until it is trusted. A new Codex task discovers
the installed Skill, custom agent, and hook.

If the user also requested a launch, continue in the current task. Do not wait for Skill discovery:
invoke the installed launcher. `--force` synchronises only the Skill-owned directory, custom-agent
file, and marked blocks in `AGENTS.md` and `.codex/config.toml`; unrelated content is preserved.
The installer does not copy environment files or configuration from another repository.

## Use

For example:

```text
Launch 3 Luna agents: one to inspect tests, one to inspect error handling, and one to inspect docs.
Wait for all three and summarize their evidence.
```

Native `luna_worker` agents are preferred. If the active model catalogue rejects that agent, the
skill uses its deterministic `codex exec` fallback without substituting another model. Normal work
is capped at 15 lanes. An explicit request for 16-50 concurrent lanes enables stress mode.

For a shared packet and 50 distinct investigators, first write a JSON array containing one
substantive `{ "name", "task" }` brief per investigator. Shared facts belong in the common packet,
but each task must still explain its owned angle, starting evidence, expected depth, independent
hypothesis work, permitted adjacent findings, and report contract. A title or attachment line range
is not a task brief. Then use one current-task command:

```sh
node .agents/skills/codex-luna-swarm/scripts/luna-lanes.cjs \
  --tasks-file /absolute/luna-tasks.json \
  --stress \
  --workdir /absolute/current/git/root \
  --instructions-file /absolute/shared-instructions.md
```

`--count 50` is reserved for an explicit rank-based concurrency test. Investigations should use
the main agent's distinct task descriptions. Before launch, the main agent should reject any row
that could be completed by answering one narrow question or inspecting one file.

`--max-active` queues excess work in one launch. Stress task files start one second apart;
`--start-interval-ms` overrides that pace. A typed HTTP 429 result means reducing the cap or pace
and retrying only missing work after the launcher settles.

Each lane prints one compact `luna_lane.finished` event; full reports remain behind `--drain`.
`luna_lanes.completed` gives terminal counts. The installed `Stop` hook keeps the parent task active
while its launcher runs and wakes it once after terminal or crash. Child lanes and other tasks are
excluded.

The launcher needs access to the active Codex state directory because it starts nested Codex CLI
processes. If the main shell tool is sandboxed, grant the launcher command that access once; the
individual lane sandboxes remain read-only.

The fallback's `--drain` command prints each newly finished report once. The main agent does not
need to read or reproduce the launcher.

## Check or remove

```sh
npx --yes --package 'github:s-smits/codex-luna-swarm#main' -- codex-luna-swarm --check
npx --yes --package 'github:s-smits/codex-luna-swarm#main' -- codex-luna-swarm --remove
```

Removal preserves unrelated `AGENTS.md` and `.codex/config.toml` content. It refuses to delete a
modified managed file or block unless `--force` is explicit.
