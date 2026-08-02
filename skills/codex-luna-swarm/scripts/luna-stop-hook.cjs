#!/usr/bin/env node
"use strict";

const { existsSync, lstatSync, readFileSync, unlinkSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

function respond(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
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

function remove(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function continuation(record, state) {
  const progress = `${record.settledCount ?? 0}/${record.laneCount ?? "?"} lanes settled`;
  if (state === "active") {
    return {
      decision: "block",
      reason:
        `The Luna swarm is still active (${progress}) at ${record.outputDir}. ` +
        "Continue this turn: poll the existing launcher session, inspect each luna_lane.finished event, " +
        "and drain unseen reports. Do not end the turn while the launcher is active.",
    };
  }
  if (state === "terminal") {
    return {
      decision: "block",
      reason:
        `The Luna swarm reached terminal state (${progress}, ${record.failedCount ?? 0} non-completed) at ` +
        `${record.outputDir}. Drain the remaining reports, inspect summary.json, and report missing work before ending.`,
    };
  }
  return {
    decision: "block",
    reason:
      `The Luna swarm launcher stopped unexpectedly (${progress}) at ${record.outputDir}. ` +
      "Inspect its terminal output, stderr, result files, and missing lanes before deciding whether to retry.",
  };
}

function main() {
  if (process.env.CODEX_LUNA_LANE === "1") {
    respond({});
    return;
  }
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    respond({});
    return;
  }
  const threadId = input?.session_id;
  if (typeof threadId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(threadId)) {
    respond({});
    return;
  }
  const path = join(tmpdir(), "codex-luna-swarm", `${threadId}.json`);
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    respond({});
    return;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    remove(path);
    respond({
      decision: "block",
      reason: "The Luna swarm registry became unreadable. Inspect the launcher terminal before ending this turn.",
    });
    return;
  }
  if (record?.threadId !== threadId || typeof record?.outputDir !== "string") {
    remove(path);
    respond({
      decision: "block",
      reason: "The Luna swarm registry is invalid. Inspect the launcher terminal before ending this turn.",
    });
    return;
  }
  if (record.status === "active" && processIsAlive(record.pid)) {
    respond(continuation(record, "active"));
    return;
  }
  remove(path);
  respond(continuation(record, record.status === "terminal" ? "terminal" : "crashed"));
}

main();
