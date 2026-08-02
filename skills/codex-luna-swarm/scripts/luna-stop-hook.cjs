#!/usr/bin/env node
"use strict";

const { existsSync, lstatSync, readFileSync, unlinkSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const reply = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch ({ code }) {
    return code !== "ESRCH";
  }
}

function main() {
  if (process.env.CODEX_LUNA_LANE === "1") return reply({});
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return reply({});
  }
  const id = input?.session_id;
  if (typeof id !== "string" || !/^[\w-]{8,128}$/.test(id)) return reply({});
  const path = join(tmpdir(), "codex-luna-swarm", `${id}.json`);
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) return reply({});

  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    unlinkSync(path);
    return reply({ decision: "block", reason: "The Luna launcher registry is unreadable. Inspect its terminal." });
  }
  if (record.threadId !== id || typeof record.outputDir !== "string") return reply({});
  if (record.status === "active" && alive(record.pid)) {
    const reason = `The Luna launcher is active at ${record.outputDir}. Poll it, follow luna_lane.finished events, and drain reports before ending.`;
    return reply({ decision: "block", reason });
  }

  unlinkSync(path);
  const reason = record.status === "terminal"
    ? `The Luna launcher finished at ${record.outputDir}. Drain and settle it.`
    : `The Luna launcher stopped unexpectedly at ${record.outputDir}. Inspect its terminal and missing lanes.`;
  return reply({ decision: "block", reason });
}

main();
