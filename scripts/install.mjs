#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const START_MARKER = "<!-- codex-luna-swarm:start -->";
const END_MARKER = "<!-- codex-luna-swarm:end -->";
const CONFIG_START_MARKER = "# codex-luna-swarm:start";
const CONFIG_END_MARKER = "# codex-luna-swarm:end";

function usage() {
  return [
    "Usage:",
    "  codex-luna-swarm [--target <absolute-git-path>] [--force]",
    "  codex-luna-swarm [--target <absolute-git-path>] --check",
    "  codex-luna-swarm [--target <absolute-git-path>] --remove [--force]",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = { mode: "install", force: false, target: process.cwd() };
  let targetWasSet = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
    } else if (argument === "--force") {
      if (options.force) throw new Error("Duplicate argument: --force");
      options.force = true;
    } else if (argument === "--check" || argument === "--remove") {
      const mode = argument.slice(2);
      if (options.mode !== "install") throw new Error("Choose only one of --check or --remove");
      options.mode = mode;
    } else if (argument === "--target") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --target");
      if (targetWasSet) throw new Error("Duplicate argument: --target");
      options.target = value;
      targetWasSet = true;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.help) return options;
  if (!isAbsolute(options.target)) throw new Error("--target must be an absolute path");
  if (options.mode === "check" && options.force) throw new Error("--check does not accept --force");
  return options;
}

function resolveGitRoot(target) {
  const directory = realpathSync(target);
  if (!statSync(directory).isDirectory()) throw new Error(`target is not a directory: ${directory}`);
  let root;
  try {
    root = execFileSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`target is not inside a Git worktree: ${directory}`);
  }
  return realpathSync(root);
}

function sourcePaths() {
  const skill = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "codex-luna-swarm"));
  return {
    skill,
    agent: join(skill, "assets", "luna_worker.toml"),
    snippet: join(skill, "assets", "AGENTS.md.snippet"),
    configSnippet: join(skill, "assets", "config.toml.snippet"),
  };
}

function destinationPaths(target) {
  return {
    skill: join(target, ".agents", "skills", "codex-luna-swarm"),
    agent: join(target, ".codex", "agents", "luna_worker.toml"),
    agents: join(target, "AGENTS.md"),
    config: join(target, ".codex", "config.toml"),
  };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function filesUnder(root) {
  if (!existsSync(root)) return null;
  if (!lstatSync(root).isDirectory()) throw new Error(`expected a directory: ${root}`);
  const entries = [];
  const visit = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error(`symbolic links are not supported in managed skill: ${absolute}`);
      if (item.isDirectory()) visit(absolute);
      else if (item.isFile()) entries.push({ path: relative(root, absolute), sha256: sha256(absolute) });
      else throw new Error(`unsupported managed skill entry: ${absolute}`);
    }
  };
  visit(root);
  return entries;
}

function equalTrees(left, right) {
  const [first, second] = [filesUnder(left), filesUnder(right)];
  return first !== null && second !== null && JSON.stringify(first) === JSON.stringify(second);
}

function sameFile(left, right) {
  return [left, right].every((path) => existsSync(path) && lstatSync(path).isFile()) && sha256(left) === sha256(right);
}

function markerRange(text, { start = START_MARKER, end = END_MARKER, label = "AGENTS.md" } = {}) {
  const first = text.indexOf(start);
  const last = text.indexOf(end);
  if (first === -1 && last === -1) return null;
  if (first === -1 || last === -1) {
    throw new Error(`${label} contains an incomplete Codex Luna Swarm block`);
  }
  if (text.indexOf(start, first + start.length) !== -1 || text.indexOf(end, last + end.length) !== -1) {
    throw new Error(`${label} contains more than one Codex Luna Swarm block`);
  }
  if (last < first) throw new Error(`${label} has reversed Codex Luna Swarm markers`);
  return { start: first, end: last + end.length };
}

export function installBlock(existing, snippet, markers = {}) {
  const normalized = snippet.trim();
  const range = markerRange(existing, markers);
  if (!range) return `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${normalized}\n`;
  const before = existing.slice(0, range.start).trimEnd();
  const after = existing.slice(range.end).trimStart();
  return `${[before, normalized, after].filter(Boolean).join("\n\n")}\n`;
}

export function removeBlock(existing, markers = {}) {
  const range = markerRange(existing, markers);
  if (!range) return existing;
  const before = existing.slice(0, range.start).trimEnd();
  const after = existing.slice(range.end).trimStart();
  const text = [before, after].filter(Boolean).join("\n\n");
  return text ? `${text}\n` : "";
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o644 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function replaceDirectory(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const staging = `${destination}.stage-${process.pid}-${Date.now()}`;
  const backup = `${destination}.backup-${process.pid}-${Date.now()}`;
  try {
    cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
    if (!existsSync(destination)) {
      renameSync(staging, destination);
      return;
    }
    renameSync(destination, backup);
    try {
      renameSync(staging, destination);
    } catch (error) {
      renameSync(backup, destination);
      throw error;
    }
    rmSync(backup, { recursive: true, force: true });
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (existsSync(backup) && !existsSync(destination)) renameSync(backup, destination);
  }
}

function readManagedText(path, label) {
  if (!existsSync(path)) return "";
  if (!lstatSync(path).isFile()) throw new Error(`${label} is not a regular file: ${path}`);
  return readFileSync(path, "utf8");
}

function preflightConflict(condition, message, force) {
  if (condition && !force) throw new Error(`${message}; rerun with --force only after reviewing it`);
}

export function runInstaller(rawOptions) {
  const target = resolveGitRoot(rawOptions.target);
  const source = sourcePaths();
  const destination = destinationPaths(target);
  const snippet = readFileSync(source.snippet, "utf8").trim();
  const configSnippet = readFileSync(source.configSnippet, "utf8").trim();
  const configMarkers = { start: CONFIG_START_MARKER, end: CONFIG_END_MARKER, label: ".codex/config.toml" };
  const agentsBefore = readManagedText(destination.agents, "AGENTS.md");
  const configBefore = readManagedText(destination.config, ".codex/config.toml");
  const agentsRange = markerRange(agentsBefore);
  const configRange = markerRange(configBefore, configMarkers);
  const installedBlock = agentsRange ? agentsBefore.slice(agentsRange.start, agentsRange.end).trim() : null;
  const installedConfigBlock = configRange ? configBefore.slice(configRange.start, configRange.end).trim() : null;

  if (rawOptions.mode === "check") {
    const checks = {
      skill: equalTrees(source.skill, destination.skill),
      agent: sameFile(source.agent, destination.agent),
      agentsBlock: installedBlock === snippet,
      configBlock: installedConfigBlock === configSnippet,
    };
    if (!Object.values(checks).every(Boolean)) {
      throw new Error(`installation check failed: ${JSON.stringify(checks)}`);
    }
    return { status: "ok", mode: "check", target, checks };
  }

  const skillChanged = existsSync(destination.skill) && !equalTrees(source.skill, destination.skill);
  const agentChanged = existsSync(destination.agent) && !sameFile(source.agent, destination.agent);
  const agentsChanged = installedBlock !== null && installedBlock !== snippet;
  const configChanged = installedConfigBlock !== null && installedConfigBlock !== configSnippet;
  preflightConflict(skillChanged, `managed skill differs at ${destination.skill}`, rawOptions.force);
  preflightConflict(agentChanged, `custom agent differs at ${destination.agent}`, rawOptions.force);
  preflightConflict(agentsChanged, `managed AGENTS.md block differs at ${destination.agents}`, rawOptions.force);
  preflightConflict(configChanged, `managed hook block differs at ${destination.config}`, rawOptions.force);

  if (rawOptions.mode === "remove") {
    if (existsSync(destination.skill)) rmSync(destination.skill, { recursive: true, force: false });
    if (existsSync(destination.agent)) unlinkSync(destination.agent);
    const agentsAfter = removeBlock(agentsBefore);
    if (agentsAfter !== agentsBefore) atomicWrite(destination.agents, agentsAfter);
    const configAfter = removeBlock(configBefore, configMarkers);
    if (configAfter !== configBefore) atomicWrite(destination.config, configAfter);
    return {
      status: "removed",
      mode: "remove",
      target,
      paths: destination,
    };
  }

  if (!equalTrees(source.skill, destination.skill)) replaceDirectory(source.skill, destination.skill);
  if (!sameFile(source.agent, destination.agent)) {
    atomicWrite(destination.agent, readFileSync(source.agent, "utf8"));
  }
  const agentsAfter = installBlock(agentsBefore, snippet);
  if (agentsAfter !== agentsBefore) atomicWrite(destination.agents, agentsAfter);
  const configAfter = installBlock(configBefore, configSnippet, configMarkers);
  if (configAfter !== configBefore) atomicWrite(destination.config, configAfter);
  const { checks } = runInstaller({ target, mode: "check", force: false });
  return {
    status: "installed",
    mode: "install",
    target,
    paths: destination,
    checks,
  };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const result = runInstaller(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
  }
}

if (isEntrypoint()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
