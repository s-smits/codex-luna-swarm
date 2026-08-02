# Codex Luna Swarm

A repo-scoped Codex skill for launching and collecting independent `gpt-5.6-luna` workers.

While Codex is working in the repository that should receive the skill, give it this repository
URL together with the work to run:

```text
Use https://github.com/s-smits/codex-luna-swarm in this repository and launch 50 Luna investigators
from the attached shared instruction packet. Before launch, write an exhaustive, self-contained
brief for each investigator. The supplied questions are starting points, not the complete scope.
```

Codex should treat its current Git root as the target. It only needs another path when the current
directory is not the intended repository.

## What is installed

- `.agents/skills/codex-luna-swarm/` — the workflow and fallback launcher;
- `.codex/agents/luna_worker.toml` — the native Luna/max agent definition;
- a small managed block in the target repository's root `AGENTS.md`.

Nothing is added to global Codex configuration.

## Installation

For the Codex agent handling the request:

1. Resolve the current Git root and inspect its `AGENTS.md` instructions and `git status --short`.
2. Obtain this repository outside the target worktree.
3. Check for an existing Luna skill, `luna_worker` definition, or managed AGENTS block. Preserve
   unrelated changes and ask before replacing a differing installation.
4. Run:

   ```sh
   node /path/to/codex-luna-swarm/scripts/install.mjs --target /absolute/current/git/root
   node /path/to/codex-luna-swarm/scripts/install.mjs --target /absolute/current/git/root --check
   ```

5. Show the target diff. A new Codex task will discover the installed Skill and custom agent.

If the user also requested a launch, continue in the current task. Do not wait for Skill discovery:
invoke the launcher from the obtained copy of this repository.

Use `--force` only after reviewing an existing managed installation. The installer changes only
the skill directory, custom-agent file, and marked AGENTS block. It does not copy environment
files or configuration from another repository.

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
node /path/to/codex-luna-swarm/skills/codex-luna-swarm/scripts/luna-lanes.cjs \
  --tasks-file /absolute/luna-tasks.json \
  --stress \
  --workdir /absolute/current/git/root \
  --instructions-file /absolute/shared-instructions.md
```

`--count 50` is reserved for an explicit rank-based concurrency test. Investigations should use
the main agent's distinct task descriptions. Before launch, the main agent should reject any row
that could be completed by answering one narrow question or inspecting one file.

The launcher needs access to the active Codex state directory because it starts nested Codex CLI
processes. If the main shell tool is sandboxed, grant the launcher command that access once; the
individual lane sandboxes remain read-only.

The fallback's `--drain` command prints each newly finished report once. The main agent does not
need to read or reproduce the launcher.

## Check or remove

```sh
node /path/to/codex-luna-swarm/scripts/install.mjs --target /absolute/current/git/root --check
node /path/to/codex-luna-swarm/scripts/install.mjs --target /absolute/current/git/root --remove
```

Removal preserves unrelated `AGENTS.md` content. It refuses to delete modified managed files or a
modified managed block unless `--force` is explicit.
