#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(repository, "skills", "codex-luna-swarm");
const skillFile = join(skill, "SKILL.md");
const metadataFile = join(skill, "agents", "openai.yaml");

function requireFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`missing file: ${path}`);
}

for (const path of [
  skillFile,
  metadataFile,
  join(skill, "scripts", "luna-lanes.cjs"),
  join(skill, "assets", "luna_worker.toml"),
  join(skill, "assets", "AGENTS.md.snippet"),
]) {
  requireFile(path);
}

const text = readFileSync(skillFile, "utf8");
const match = text.match(/^---\n([\s\S]*?)\n---\n/);
if (!match) throw new Error("SKILL.md must start with YAML frontmatter");
const rows = match[1].split("\n").filter(Boolean);
const fields = new Map(
  rows.map((row) => {
    const separator = row.indexOf(":");
    if (separator < 1) throw new Error(`invalid frontmatter row: ${row}`);
    return [row.slice(0, separator).trim(), row.slice(separator + 1).trim()];
  }),
);
if (JSON.stringify([...fields.keys()].sort()) !== JSON.stringify(["description", "name"])) {
  throw new Error("SKILL.md frontmatter must contain only name and description");
}
if (fields.get("name") !== "codex-luna-swarm") throw new Error("unexpected skill name");
if (!fields.get("description") || fields.get("description").length < 40) {
  throw new Error("skill description is too short");
}
if (/\bTODO\b/.test(text)) throw new Error("SKILL.md still contains TODO text");

const metadata = readFileSync(metadataFile, "utf8");
for (const expected of [
  'display_name: "Codex Luna Swarm"',
  "short_description:",
  'default_prompt: "Use $codex-luna-swarm',
]) {
  if (!metadata.includes(expected)) throw new Error(`openai.yaml is missing ${expected}`);
}

process.stdout.write("Skill is valid.\n");
