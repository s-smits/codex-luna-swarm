# AGENTS.md

This repository distributes one repo-scoped Codex skill. Keep workflow instructions in
`skills/codex-luna-swarm/SKILL.md`; keep the installed AGENTS block small.

Use a Node version allowed by `package.json`. Run `npm test` and `npm run validate-skill` after
changing the installer, launcher, skill, custom-agent asset, or managed snippet. The launcher has
no lane-count ceiling; use pacing and `maxActive` to control pressure.
