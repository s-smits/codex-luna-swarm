#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(repository, "skills", "codex-luna-swarm");
const skillFile = join(skill, "SKILL.md");
const metadataFile = join(skill, "agents", "openai.yaml");
const readmeFile = join(repository, "README.md");
const agentsSnippetFile = join(skill, "assets", "AGENTS.md.snippet");

function requireFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`missing file: ${path}`);
}

for (const path of [
  readmeFile,
  skillFile,
  metadataFile,
  join(skill, "scripts", "luna-lanes.cjs"),
  join(skill, "assets", "luna_worker.toml"),
  join(skill, "assets", "AGENTS.md.snippet"),
  join(skill, "assets", "config.toml.snippet"),
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
for (const expected of [
  "## Check required inputs first",
  "## Interpret the requested terminal",
  "## Define bounded lanes",
  "## Use native Luna for 1-15 lanes",
  "## Use the fallback launcher",
  "## Collect only when requested",
  "`luna_lanes.started`",
  "--launch-only",
  "do not build a phrase linter",
]) {
  if (!text.includes(expected)) throw new Error(`SKILL.md is missing required guidance: ${expected}`);
}

const metadata = readFileSync(metadataFile, "utf8");
for (const expected of [
  'display_name: "Codex Luna Swarm"',
  "short_description:",
  'default_prompt: "Use $codex-luna-swarm',
  "launch receipt",
]) {
  if (!metadata.includes(expected)) throw new Error(`openai.yaml is missing ${expected}`);
}

const publicContract = `${readFileSync(readmeFile, "utf8")}\n${readFileSync(agentsSnippetFile, "utf8")}`;
for (const expected of [
  "Do not prepare or launch Luna agents in this turn",
  "After setup, start the actual Luna work in a new Codex task",
  "continue and derive the lane scopes from the repository",
  "proceed to accepted transport in the same turn",
  "propose fixes",
]) {
  if (!publicContract.includes(expected)) throw new Error(`public contract is missing ${expected}`);
}
for (const forbidden of ["The attachment in this message is required", "do nothing else"]) {
  if (publicContract.includes(forbidden)) throw new Error(`public contract contains stale hard gate: ${forbidden}`);
}

process.stdout.write("Skill is valid.\n");
