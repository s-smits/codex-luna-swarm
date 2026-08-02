#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  accessSync,
  closeSync,
  constants,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, dirname, isAbsolute, join, resolve } = require("node:path");

const MODEL = "gpt-5.6-luna";
const REASONING = "max";
const SERVICE_TIER = "priority";
const NORMAL_MAX_LANES = 15;
const STRESS_MAX_LANES = 50;
const BUNDLED_CODEX = "/Applications/ChatGPT.app/Contents/Resources/codex";
const HOMEBREW_CODEX = "/opt/homebrew/bin/codex";
const LAUNCH_SCHEMA_VERSION = 1;
const SEEN_SCHEMA_VERSION = 1;
const MAX_PROMPT_CHARACTERS = 200_000;
const MAX_INSTRUCTION_BYTES = MAX_PROMPT_CHARACTERS * 4;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_PREFIX_BYTES = 1024 * 1024;

function usage() {
  return [
    "Usage: luna-lanes --manifest <absolute-json-path> [options]",
    "       luna-lanes --count <1-50> --workdir <absolute-directory> --instructions-file <absolute-file> [options]",
    "       luna-lanes --tasks-file <absolute-json-path> --workdir <absolute-directory> --instructions-file <absolute-file> [options]",
    "       luna-lanes --drain <absolute-output-directory>",
    "",
    "Options:",
    "  --output-dir <absolute-new-directory>",
    "  --codex-bin <absolute-executable>",
    "  --task-template <text with optional {i} and {count}>",
    "  --stress  Required when a direct launch contains 16-50 lanes",
    "  --ephemeral",
    "  --help",
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = { ephemeral: false, stress: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ephemeral") {
      if (parsed.ephemeral) throw new Error("Duplicate argument: --ephemeral");
      parsed.ephemeral = true;
    } else if (arg === "--stress") {
      if (parsed.stress) throw new Error("Duplicate argument: --stress");
      parsed.stress = true;
    } else if (arg === "--help") {
      parsed.help = true;
    } else if (
      [
        "--manifest",
        "--drain",
        "--output-dir",
        "--codex-bin",
        "--count",
        "--tasks-file",
        "--workdir",
        "--instructions-file",
        "--task-template",
      ].includes(arg)
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      const key = arg.slice(2).replaceAll("-", "_");
      if (parsed[key] !== undefined) throw new Error(`Duplicate argument: ${arg}`);
      parsed[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function quickManifest(options) {
  if (Boolean(options.count) === Boolean(options.tasks_file)) {
    throw new Error("choose exactly one of --count or --tasks-file for a direct launch");
  }
  let source;
  if (options.tasks_file) {
    if (options.task_template !== undefined) {
      throw new Error("--task-template is accepted only with --count");
    }
    const tasksPath = absoluteExistingFile(options.tasks_file, "--tasks-file");
    if (statSync(tasksPath).size > MAX_MANIFEST_BYTES) {
      throw new Error(`--tasks-file exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    source = JSON.parse(readFileSync(tasksPath, "utf8"));
    if (!Array.isArray(source)) throw new Error("--tasks-file must contain a JSON array");
  } else {
    if (!/^\d+$/.test(options.count)) throw new Error("--count must be an integer from 1 to 50");
    const count = Number(options.count);
    if (count < 1 || count > STRESS_MAX_LANES) throw new Error("--count must be an integer from 1 to 50");
    source = Array.from({ length: count }, () => null);
  }
  const count = source.length;
  if (count < 1 || count > STRESS_MAX_LANES) {
    throw new Error("direct launch must contain 1-50 lanes");
  }
  if (count > NORMAL_MAX_LANES && !options.stress) {
    throw new Error("direct launch of 16-50 lanes requires --stress");
  }
  if (!options.workdir) throw new Error("--workdir is required for a direct launch");
  if (!options.instructions_file) throw new Error("--instructions-file is required for a direct launch");
  const template =
    options.task_template ??
    "You are investigator {i} of {count}. Follow the shared instructions and return the requested report.";
  if (typeof template !== "string" || template.trim().length === 0) {
    throw new Error("--task-template must be non-empty text");
  }
  const width = Math.max(2, String(count).length);
  const lanes = source.map((entry, index) => {
    const rank = index + 1;
    if (options.tasks_file) {
      if (typeof entry === "string") {
        return { name: `luna_${String(rank).padStart(width, "0")}`, task: entry };
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`tasks[${index}] must be a string or an object with name and task`);
      }
      const unexpected = Object.keys(entry).filter((key) => !new Set(["name", "task"]).has(key));
      if (unexpected.length > 0) {
        throw new Error(`tasks[${index}] has unsupported fields: ${unexpected.join(", ")}`);
      }
      return {
        name: entry.name ?? `luna_${String(rank).padStart(width, "0")}`,
        task: entry.task,
      };
    }
    return {
      name: `luna_${String(rank).padStart(width, "0")}`,
      task: template.replaceAll("{i}", String(rank)).replaceAll("{count}", String(count)),
    };
  });
  if (options.tasks_file) {
    const descriptions = new Set();
    lanes.forEach((lane, index) => {
      if (typeof lane.task !== "string" || lane.task.trim().length === 0) {
        throw new Error(`tasks[${index}].task must be non-empty text`);
      }
      const description = lane.task.trim();
      if (descriptions.has(description)) throw new Error(`duplicate task description at tasks[${index}]`);
      descriptions.add(description);
    });
  }
  return {
    workdir: options.workdir,
    instructionsFile: options.instructions_file,
    stress: options.stress,
    lanes,
  };
}

function absoluteExistingDirectory(value, field) {
  if (!isAbsolute(value)) throw new Error(`${field} must be an absolute path`);
  const actual = realpathSync(value);
  if (!statSync(actual).isDirectory()) throw new Error(`${field} must be a directory`);
  return actual;
}

function absoluteExistingFile(value, field) {
  if (!isAbsolute(value)) throw new Error(`${field} must be an absolute path`);
  const actual = realpathSync(value);
  if (!statSync(actual).isFile()) throw new Error(`${field} must be a file`);
  return actual;
}

function optionalText(value, field) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value.trim();
}

function sharedInstructions(raw) {
  if (Array.isArray(raw) || !raw || typeof raw !== "object") return "";
  const inline = optionalText(raw.instructions, "instructions");
  let fromFile = "";
  if (raw.instructionsFile !== undefined) {
    if (typeof raw.instructionsFile !== "string") {
      throw new Error("instructionsFile must be an absolute file path");
    }
    const path = absoluteExistingFile(raw.instructionsFile, "instructionsFile");
    if (statSync(path).size > MAX_INSTRUCTION_BYTES) {
      throw new Error(`instructionsFile exceeds ${MAX_INSTRUCTION_BYTES} bytes`);
    }
    fromFile = readFileSync(path, "utf8").trim();
  }
  return [fromFile, inline].filter(Boolean).join("\n\n");
}

function normalizeManifest(raw) {
  const source = Array.isArray(raw) ? raw : raw?.lanes;
  const stress = !Array.isArray(raw) && raw?.stress === true;
  const maxLanes = stress ? STRESS_MAX_LANES : NORMAL_MAX_LANES;
  if (!Array.isArray(source) || source.length < 1 || source.length > maxLanes) {
    throw new Error(
      `manifest must contain 1-${NORMAL_MAX_LANES} lanes, or 1-${STRESS_MAX_LANES} with stress: true`,
    );
  }
  const defaultWorkdir = Array.isArray(raw) ? undefined : raw.workdir;
  const defaultSandbox = Array.isArray(raw) ? "read-only" : (raw.sandbox ?? "read-only");
  const instructions = sharedInstructions(raw);
  const names = new Set();
  return source.map((lane, index) => {
    if (!lane || typeof lane !== "object" || Array.isArray(lane)) {
      throw new Error(`lanes[${index}] must be an object`);
    }
    const { name } = lane;
    if (typeof name !== "string" || !/^[a-z][a-z0-9_]{0,47}$/.test(name)) {
      throw new Error(`lanes[${index}].name must match ^[a-z][a-z0-9_]{0,47}$`);
    }
    if (names.has(name)) throw new Error(`duplicate lane name: ${name}`);
    names.add(name);
    if (lane.task !== undefined && lane.prompt !== undefined) {
      throw new Error(`lanes[${index}] must use task or prompt, not both`);
    }
    const task = lane.task ?? lane.prompt;
    if (typeof task !== "string" || task.trim().length === 0) {
      throw new Error(`lanes[${index}].task (or prompt) must be a non-empty string`);
    }
    const prompt = [instructions, task.trim()].filter(Boolean).join("\n\n");
    if (prompt.length > MAX_PROMPT_CHARACTERS) {
      throw new Error(`lanes[${index}] combined instructions and task exceed ${MAX_PROMPT_CHARACTERS} characters`);
    }
    const workdir = lane.workdir ?? defaultWorkdir;
    if (typeof workdir !== "string") {
      throw new Error(`lanes[${index}].workdir is required when manifest.workdir is absent`);
    }
    const sandbox = lane.sandbox ?? defaultSandbox;
    if (!new Set(["read-only", "workspace-write"]).has(sandbox)) {
      throw new Error(`lanes[${index}].sandbox must be read-only or workspace-write`);
    }
    const ownedPaths = lane.ownedPaths ?? [];
    if (
      !Array.isArray(ownedPaths) ||
      ownedPaths.some(
        (path) =>
          typeof path !== "string" || path.trim().length === 0 || path.includes("\0") || /[\r\n]/.test(path),
      )
    ) {
      throw new Error(`lanes[${index}].ownedPaths must contain non-empty single-line paths`);
    }
    if (sandbox === "workspace-write" && ownedPaths.length === 0) {
      throw new Error(`write lane ${name} must declare ownedPaths`);
    }
    return {
      name,
      prompt,
      workdir: absoluteExistingDirectory(workdir, `lanes[${index}].workdir`),
      sandbox,
      ownedPaths,
    };
  });
}

function resolveCodexBinary(override) {
  const candidate = override ?? [BUNDLED_CODEX, HOMEBREW_CODEX].find(existsSync) ?? "codex";
  if (candidate.includes("/")) {
    if (!isAbsolute(candidate)) throw new Error("--codex-bin must be absolute");
    accessSync(candidate, constants.X_OK);
  }
  return candidate;
}

function createOutputDirectory(explicit) {
  if (!explicit) return realpathSync(mkdtempSync(join(tmpdir(), "luna-lanes-")));
  if (!isAbsolute(explicit)) throw new Error("--output-dir must be absolute");
  const target = resolve(explicit);
  if (existsSync(target)) throw new Error("--output-dir must not already exist");
  const parent = realpathSync(dirname(target));
  const output = join(parent, basename(target));
  mkdirSync(output, { mode: 0o700 });
  return output;
}

function lanePrompt(lane) {
  if (lane.sandbox === "read-only") {
    return `${lane.prompt}\n\nAuthority: read-only. Do not edit files or change external state.`;
  }
  return [
    lane.prompt,
    "",
    `Authority: workspace-write. You own only: ${lane.ownedPaths.join(", ")}.`,
    "Other agents may be editing the repository. Preserve their work and do not revert it.",
  ].join("\n");
}

function laneArtifacts(outputDir, name) {
  return {
    eventPath: join(outputDir, `${name}.jsonl`),
    stderrPath: join(outputDir, `${name}.stderr.log`),
    reportPath: join(outputDir, `${name}.md`),
    resultPath: join(outputDir, `${name}.result.json`),
  };
}

function atomicJson(path, value, replace = false) {
  if (!replace && existsSync(path)) throw new Error(`refusing to overwrite ${path}`);
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    if (replace) {
      renameSync(temporary, path);
    } else {
      linkSync(temporary, path);
      unlinkSync(temporary);
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function regularFileExists(path) {
  return existsSync(path) && lstatSync(path).isFile();
}

function threadIdFromEvents(path) {
  if (!regularFileExists(path)) return null;
  const length = Math.min(statSync(path).size, MAX_EVENT_PREFIX_BYTES);
  if (length === 0) return null;
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  let bytesRead;
  try {
    bytesRead = readSync(fd, buffer, 0, length, 0);
  } finally {
    closeSync(fd);
  }
  for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        return event.thread_id;
      }
    } catch {
      // A malformed diagnostic line is preserved in the event log and ignored here.
    }
  }
  return null;
}

async function runLane(lane, options) {
  const { eventPath, stderrPath, reportPath } = laneArtifacts(options.outputDir, lane.name);
  const eventFd = openSync(eventPath, "wx", 0o600);
  const stderrFd = openSync(stderrPath, "wx", 0o600);
  const args = [
    "exec",
    "--model",
    MODEL,
    "--config",
    `model_reasoning_effort=\"${REASONING}\"`,
    "--config",
    `service_tier=\"${SERVICE_TIER}\"`,
    "--sandbox",
    lane.sandbox,
    "--json",
    "--output-last-message",
    reportPath,
  ];
  if (options.ephemeral) args.push("--ephemeral");
  args.push("-");

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  let child;
  try {
    child = spawn(options.codexBin, args, {
      cwd: lane.workdir,
      env: process.env,
      shell: false,
      stdio: ["pipe", eventFd, stderrFd],
    });
  } catch (error) {
    closeSync(eventFd);
    closeSync(stderrFd);
    return {
      name: lane.name,
      status: "spawn-error",
      exitCode: null,
      signal: null,
      error: String(error),
      threadId: threadIdFromEvents(eventPath),
      durationMs: Date.now() - startedAt,
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      reportPath,
      eventPath,
      stderrPath,
    };
  }
  closeSync(eventFd);
  closeSync(stderrFd);
  child.stdin.on("error", () => {});
  child.stdin.end(lanePrompt(lane));

  const completion = await new Promise((resolveCompletion) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveCompletion(value);
    };
    child.once("error", (error) => settle({ exitCode: null, signal: null, error: String(error) }));
    child.once("close", (exitCode, signal) => settle({ exitCode, signal, error: null }));
  });
  const reportExists = regularFileExists(reportPath);
  const completed = completion.exitCode === 0 && reportExists;
  return {
    name: lane.name,
    status: completed ? "completed" : "failed",
    exitCode: completion.exitCode,
    signal: completion.signal,
    error:
      completion.error ??
      (completion.exitCode === 0 && !reportExists ? "Codex exited successfully without writing a report" : null),
    threadId: threadIdFromEvents(eventPath),
    durationMs: Date.now() - startedAt,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    reportPath,
    eventPath,
    stderrPath,
  };
}

function reportSection(result) {
  const report = regularFileExists(result.reportPath)
    ? readFileSync(result.reportPath, "utf8").trimEnd()
    : "(No report file was produced. Inspect the stderr and JSONL paths below.)";
  return [
    `## ${result.name}`,
    "",
    `Status: ${result.status}`,
    `Thread: ${result.threadId ?? "none"}`,
    `Duration: ${result.durationMs} ms`,
    `JSONL: ${result.eventPath}`,
    `Stderr: ${result.stderrPath}`,
    result.error ? `Error: ${result.error}` : null,
    "",
    report,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function writeCollectedReports(outputDir, results) {
  const path = join(outputDir, "reports.md");
  const text = ["# Luna lane reports", "", ...results.map(reportSection)].join("\n");
  writeFileSync(path, `${text.trimEnd()}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return path;
}

async function runLunaLanes(rawManifest, options = {}) {
  const lanes = normalizeManifest(rawManifest);
  const stress = !Array.isArray(rawManifest) && rawManifest?.stress === true;
  const outputDir = createOutputDirectory(options.outputDir);
  const codexBin = resolveCodexBinary(options.codexBin);
  const startedAt = new Date().toISOString();
  const launch = {
    schemaVersion: LAUNCH_SCHEMA_VERSION,
    type: "luna_lanes.launch",
    model: MODEL,
    reasoningEffort: REASONING,
    serviceTier: SERVICE_TIER,
    stress,
    outputDir,
    startedAt,
    lanes: lanes.map((lane) => ({
      name: lane.name,
      workdir: lane.workdir,
      sandbox: lane.sandbox,
      ownedPaths: lane.ownedPaths,
      promptSha256: createHash("sha256").update(lanePrompt(lane)).digest("hex"),
    })),
  };
  atomicJson(join(outputDir, "launch.json"), launch);
  if (typeof options.onStart === "function") options.onStart(launch);
  const results = await Promise.all(
    lanes.map(async (lane) => {
      const result = await runLane(lane, { codexBin, outputDir, ephemeral: options.ephemeral === true });
      atomicJson(laneArtifacts(outputDir, lane.name).resultPath, result);
      return result;
    }),
  );
  const reportsPath = writeCollectedReports(outputDir, results);
  const summary = {
    schemaVersion: LAUNCH_SCHEMA_VERSION,
    type: "luna_lanes.completed",
    model: MODEL,
    reasoningEffort: REASONING,
    serviceTier: SERVICE_TIER,
    stress,
    outputDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    reportsPath,
    lanes: results,
  };
  atomicJson(join(outputDir, "summary.json"), summary);
  return summary;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readLaunch(outputDirectory) {
  const outputDir = absoluteExistingDirectory(outputDirectory, "--drain");
  const path = join(outputDir, "launch.json");
  if (!regularFileExists(path)) throw new Error(`not a Luna lane output directory: ${outputDir}`);
  const launch = readJson(path, "launch record");
  let recordedOutputDir = null;
  try {
    if (typeof launch?.outputDir === "string") {
      recordedOutputDir = absoluteExistingDirectory(launch.outputDir, "launch.outputDir");
    }
  } catch {
    // The structural check below reports one stable invalid-record error.
  }
  if (
    launch?.schemaVersion !== LAUNCH_SCHEMA_VERSION ||
    launch?.type !== "luna_lanes.launch" ||
    recordedOutputDir !== outputDir ||
    !Array.isArray(launch?.lanes)
  ) {
    throw new Error(`invalid Luna launch record: ${path}`);
  }
  const names = new Set();
  for (const lane of launch.lanes) {
    if (!lane || typeof lane.name !== "string" || !/^[a-z][a-z0-9_]{0,47}$/.test(lane.name)) {
      throw new Error(`invalid lane in Luna launch record: ${path}`);
    }
    if (names.has(lane.name)) throw new Error(`duplicate lane in Luna launch record: ${lane.name}`);
    names.add(lane.name);
  }
  return { launch, outputDir, names };
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function acquireDrainLock(outputDir) {
  const path = join(outputDir, ".drain.lock");
  const create = () => {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      return { fd, path };
    } catch (error) {
      closeSync(fd);
      try {
        unlinkSync(path);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
      throw error;
    }
  };
  try {
    return create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner;
    try {
      owner = readJson(path, "drain lock");
    } catch {
      throw new Error(`another drain owns ${path}; its lock record is unreadable`);
    }
    if (processIsAlive(owner?.pid)) throw new Error(`another drain is active for ${outputDir}`);
    try {
      unlinkSync(path);
    } catch (unlinkError) {
      if (unlinkError?.code !== "ENOENT") throw unlinkError;
    }
    return create();
  }
}

function releaseDrainLock(lock) {
  try {
    closeSync(lock.fd);
  } finally {
    try {
      unlinkSync(lock.path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function readSeen(outputDir, validNames) {
  const path = join(outputDir, ".seen-reports.json");
  if (!existsSync(path)) return { path, names: new Set() };
  if (!regularFileExists(path)) throw new Error(`invalid seen-report state: ${path}`);
  const state = readJson(path, "seen-report state");
  if (state?.schemaVersion !== SEEN_SCHEMA_VERSION || !Array.isArray(state?.shown)) {
    throw new Error(`invalid seen-report state: ${path}`);
  }
  const names = new Set();
  for (const name of state.shown) {
    if (typeof name !== "string" || !validNames.has(name)) {
      throw new Error(`seen-report state contains an unknown lane: ${String(name)}`);
    }
    names.add(name);
  }
  return { path, names };
}

async function drainReports(outputDirectory, emit = writeStdout) {
  const { launch, outputDir, names: validNames } = readLaunch(outputDirectory);
  const lock = acquireDrainLock(outputDir);
  try {
    const seen = readSeen(outputDir, validNames);
    const unseen = [];
    for (const lane of launch.lanes) {
      if (seen.names.has(lane.name)) continue;
      const artifacts = laneArtifacts(outputDir, lane.name);
      if (!regularFileExists(artifacts.resultPath)) continue;
      const result = readJson(artifacts.resultPath, `${lane.name} result`);
      if (
        result?.name !== lane.name ||
        !new Set(["completed", "failed", "spawn-error"]).has(result?.status)
      ) {
        throw new Error(`invalid Luna lane result: ${artifacts.resultPath}`);
      }
      unseen.push({
        ...result,
        reportPath: artifacts.reportPath,
        eventPath: artifacts.eventPath,
        stderrPath: artifacts.stderrPath,
      });
    }
    if (unseen.length === 0) return { outputDir, count: 0, names: [] };

    const output = `${unseen.map(reportSection).join("\n").trimEnd()}\n`;
    await emit(output);
    for (const result of unseen) seen.names.add(result.name);
    atomicJson(
      seen.path,
      {
        schemaVersion: SEEN_SCHEMA_VERSION,
        shown: launch.lanes.map((lane) => lane.name).filter((name) => seen.names.has(name)),
        updatedAt: new Date().toISOString(),
      },
      true,
    );
    return { outputDir, count: unseen.length, names: unseen.map((result) => result.name) };
  } finally {
    releaseDrainLock(lock);
  }
}

function writeStdout(value) {
  if (!value) return Promise.resolve();
  return new Promise((resolveWrite, rejectWrite) => {
    process.stdout.write(value, (error) => (error ? rejectWrite(error) : resolveWrite()));
  });
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const quickOptionNames = ["count", "tasks_file", "workdir", "instructions_file", "task_template"];
  const usesQuickLaunch = options.stress || quickOptionNames.some((name) => options[name] !== undefined);
  const modeCount = Number(Boolean(options.manifest)) + Number(Boolean(options.drain)) + Number(usesQuickLaunch);
  if (modeCount !== 1) {
    throw new Error("choose exactly one of --manifest, a direct launch, or --drain");
  }
  if (options.drain) {
    if (options.output_dir || options.codex_bin || options.ephemeral) {
      throw new Error("--drain does not accept launch options");
    }
    await drainReports(options.drain, writeStdout);
    return 0;
  }
  let manifest;
  if (options.manifest) {
    if (!isAbsolute(options.manifest)) throw new Error("--manifest must be an absolute path");
    const manifestPath = absoluteExistingFile(options.manifest, "--manifest");
    if (statSync(manifestPath).size > MAX_MANIFEST_BYTES) {
      throw new Error(`--manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
    }
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } else {
    manifest = quickManifest(options);
  }
  const summary = await runLunaLanes(manifest, {
    outputDir: options.output_dir,
    codexBin: options.codex_bin,
    ephemeral: options.ephemeral,
    onStart: (launch) => {
      process.stdout.write(
        `${JSON.stringify({
          type: "luna_lanes.started",
          outputDir: launch.outputDir,
          laneCount: launch.lanes.length,
          model: launch.model,
          reasoningEffort: launch.reasoningEffort,
          serviceTier: launch.serviceTier,
        })}\n`,
      );
    },
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary.lanes.every((lane) => lane.status === "completed") ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

module.exports = { drainReports, normalizeManifest, parseArgs, quickManifest, runLunaLanes };
