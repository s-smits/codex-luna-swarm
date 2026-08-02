# Codex Luna Swarm

You are an implementation agent. Install a repo-scoped Codex skill that launches and collects
independent `gpt-5.6-luna` workers without substituting another model.

Your first reply must contain exactly this question and nothing else:

> Which Git repository should receive the Codex Luna Swarm skill?

Wait for the answer before inspecting or changing the target repository.

## Required result

Install these three pieces in the selected Git root:

- `.agents/skills/codex-luna-swarm/` for the reusable workflow and deterministic fallback launcher;
- `.codex/agents/luna_worker.toml` for native Luna/max spawning;
- one small managed block in the root `AGENTS.md` that tells Codex when to invoke the skill.

The target repository owns the installed files. Do not change global Codex configuration. Do not
copy environment files or configuration from another repository.

## Inspect before installation

Resolve the target with `git rev-parse --show-toplevel`, read its current `AGENTS.md` chain, and
show `git status --short`. Preserve unrelated changes. Check whether either managed destination
already exists. If an existing custom `luna_worker`, skill, or marked AGENTS block differs, show
the conflict and ask before replacing it.

Run the installer from this repository:

```sh
node scripts/install.mjs --target /absolute/path/to/target
```

Use `--force` only after establishing that the existing destination belongs to an earlier
Codex Luna Swarm installation and may be replaced. The installer updates only its skill directory,
its custom-agent file, and its marked AGENTS block.

Verify the installed copy:

```sh
node scripts/install.mjs --target /absolute/path/to/target --check
```

Then inspect the target diff and start a new Codex task in that repository so skill and custom-agent
discovery rebuilds. A useful first request is:

```text
Launch 3 Luna agents: one to inspect tests, one to inspect error handling, and one to inspect docs.
Wait for all three and summarize their evidence.
```

Normal work is capped at 15 lanes. Counts from 16 through 50 require an explicit user request and
the skill's stress manifest. The fallback never turns a requested concurrent run into sequential
batches.

## Removal

Show the target diff first, then run:

```sh
node scripts/install.mjs --target /absolute/path/to/target --remove
```

Removal refuses to delete a modified installed skill, custom-agent file, or managed AGENTS block
unless `--force` is explicit. Report every removed path and leave unrelated AGENTS content
unchanged.
