"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { after, test } = require("node:test");

const hookPath = join(
  __dirname,
  "..",
  "skills",
  "codex-luna-swarm",
  "scripts",
  "luna-stop-hook.cjs",
);
const registryDirectory = join(tmpdir(), "codex-luna-swarm");
const paths = [];

function registry(status, pid = process.pid) {
  mkdirSync(registryDirectory, { recursive: true, mode: 0o700 });
  const threadId = `test_hook_${process.pid}_${Math.random().toString(16).slice(2)}`;
  const path = join(registryDirectory, `${threadId}.json`);
  writeFileSync(
    path,
    `${JSON.stringify({
      schemaVersion: 1,
      threadId,
      pid,
      status,
      outputDir: "/tmp/luna-output",
      laneCount: 50,
      settledCount: 12,
      failedCount: 1,
    })}\n`,
    { mode: 0o600 },
  );
  paths.push(path);
  return { path, threadId };
}

function runHook(threadId, env = {}) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: `${JSON.stringify({ session_id: threadId, hook_event_name: "Stop" })}\n`,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

after(() => {
  for (const path of paths) rmSync(path, { force: true });
});

test("keeps the parent turn active while its Luna launcher is alive", () => {
  const active = registry("active");
  const output = runHook(active.threadId);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /still active \(12\/50 lanes settled\)/);
  assert.equal(existsSync(active.path), true);
});

test("wakes the parent once for terminal or crashed launchers", () => {
  const terminal = registry("terminal");
  const output = runHook(terminal.threadId);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /reached terminal state/);
  assert.equal(existsSync(terminal.path), false);

  const crashed = registry("active", 999_999_999);
  const crashOutput = runHook(crashed.threadId);
  assert.equal(crashOutput.decision, "block");
  assert.match(crashOutput.reason, /stopped unexpectedly/);
  assert.equal(existsSync(crashed.path), false);
});

test("does not keep a Luna lane itself alive", () => {
  const active = registry("active");
  assert.deepEqual(runHook(active.threadId, { CODEX_LUNA_LANE: "1" }), {});
});
