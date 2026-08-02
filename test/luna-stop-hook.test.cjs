"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");

const hook = join(__dirname, "..", "skills", "codex-luna-swarm", "scripts", "luna-stop-hook.cjs");
const directory = join(tmpdir(), "codex-luna-swarm");

function fixture(terminal = false, pid = process.pid) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = `test_hook_${process.pid}_${Math.random().toString(16).slice(2)}`;
  const path = join(directory, `${id}.json`);
  const outputDir = join(directory, `${id}-output`);
  mkdirSync(outputDir);
  if (terminal) writeFileSync(join(outputDir, "summary.json"), "{}");
  writeFileSync(path, JSON.stringify({ threadId: id, pid, outputDir }));
  return { id, path, outputDir };
}

function run(id, env = {}) {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ session_id: id }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("continues only the parent and wakes it after terminal or crash", () => {
  const active = fixture();
  assert.match(run(active.id).reason, /is active/);
  assert.deepEqual(run(active.id, { CODEX_LUNA_LANE: "1" }), {});
  rmSync(active.path, { force: true });

  const terminal = fixture(true);
  assert.match(run(terminal.id).reason, /finished/);
  assert.equal(existsSync(terminal.path), false);

  const crashed = fixture(false, 999_999_999);
  assert.match(run(crashed.id).reason, /stopped unexpectedly/);
  assert.equal(existsSync(crashed.path), false);
  for (const item of [active, terminal, crashed]) rmSync(item.outputDir, { recursive: true, force: true });
});
