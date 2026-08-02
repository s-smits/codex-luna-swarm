# AGENTS.md

This repository distributes one repo-scoped Codex skill. Keep workflow instructions in
`skills/codex-luna-swarm/SKILL.md`; keep the installed AGENTS block small.

Use Node 24.13.0 from `.nvmrc`. Run `npm test` and `npm run validate-skill` after changing the
installer, launcher, skill, custom-agent asset, or managed snippet. Preserve the normal 15-lane cap;
16-50 lanes require an explicit operator count and `stress: true`.
