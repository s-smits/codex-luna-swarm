"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { after, test } = require("node:test");
const launcherPath = join(__dirname, "..", "skills", "codex-luna-swarm", "scripts", "luna-lanes.cjs");
const { drainReports, normalizeManifest, parseArgs, quickManifest, runLunaLanes } = require(launcherPath);

const roots = [];

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "luna-lanes-test-"));
  roots.push(root);
  return root;
}

function runCli(args, env = {}, input) {
  return spawnSync(process.execPath, [launcherPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, CODEX_THREAD_ID: "", ...env },
    input,
  });
}

function fakeCodex(root) {
  const executable = join(root, "fake-codex.cjs");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
"use strict";
const { appendFileSync, writeFileSync } = require("node:fs");
const { basename } = require("node:path");
const args = process.argv.slice(2);
const reportPath = args[args.indexOf("--output-last-message") + 1];
const name = basename(reportPath, ".md");
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { prompt += chunk; });
process.stdin.on("end", () => {
  const record = (event) => appendFileSync(process.env.LUNA_FAKE_EVENTS, JSON.stringify({ event, name, at: Date.now(), args, prompt, path: process.env.PATH, zdotdir: process.env.ZDOTDIR }) + "\\n");
  record("start");
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-" + name }) + "\\n");
  setTimeout(() => {
    if (name === "rate_limited") {
      process.stderr.write("HTTP 429 Too Many Requests after WebSocket fallback\\n");
      record("end");
      process.exit(1);
      return;
    }
    writeFileSync(reportPath, "code from " + name + "\\n");
    record("end");
    process.exit(0);
  }, Number(process.env.LUNA_FAKE_DELAY ?? 180));
});
`,
    { mode: 0o700 },
  );
  chmodSync(executable, 0o700);
  return executable;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("launches independent Luna lanes concurrently without shell interpolation", async () => {
  const root = scratch();
  const second = join(root, "second");
  mkdirSync(second);
  const outputDir = join(root, "output");
  const eventsPath = join(root, "events.jsonl");
  const instructionsPath = join(root, "instructions.md");
  const marker = join(root, "must-not-exist");
  writeFileSync(instructionsPath, "Shared evidence packet");
  const previousEvents = process.env.LUNA_FAKE_EVENTS;
  process.env.LUNA_FAKE_EVENTS = eventsPath;
  try {
    const summary = await runLunaLanes(
      {
        workdir: root,
        instructionsFile: instructionsPath,
        startIntervalMs: 0,
        lanes: [
          { name: "read_lane", task: `Inspect $(touch ${marker})` },
          { name: "rate_limited", task: "Inspect the limited lane." },
          {
            name: "write_lane",
            workdir: second,
            task: "Implement the named file",
            sandbox: "workspace-write",
            ownedPaths: ["src/example.ts"],
          },
        ],
      },
      {
        codexBin: fakeCodex(root),
        outputDir,
        ephemeral: true,
        onStart: (launch) => {
          assert.equal(launch.outputDir, realpathSync(outputDir));
          assert.equal(launch.lanes.length, 3);
          assert.ok(existsSync(join(outputDir, "launch.json")));
        },
      },
    );

    assert.deepEqual(
      summary.lanes.map(({ name, status, exitCode, threadId }) => ({ name, status, exitCode, threadId })),
      [
        { name: "read_lane", status: "completed", exitCode: 0, threadId: "thread-read_lane" },
        { name: "rate_limited", status: "failed", exitCode: 1, threadId: "thread-rate_limited" },
        { name: "write_lane", status: "completed", exitCode: 0, threadId: "thread-write_lane" },
      ],
    );
    const events = readFileSync(eventsPath, "utf8").trim().split("\n").map(JSON.parse);
    const starts = events.filter((event) => event.event === "start").map((event) => event.at);
    const ends = events.filter((event) => event.event === "end").map((event) => event.at);
    assert.equal(starts.length, 3);
    assert.equal(ends.length, 3);
    assert.ok(Math.max(...starts) < Math.min(...ends), "lane lifetimes must overlap");
    assert.equal(existsSync(marker), false);
    assert.ok(events.every((event) => event.args.includes("gpt-5.6-luna")));
    assert.ok(events.every((event) => event.args.includes('model_reasoning_effort="max"')));
    assert.ok(events.every((event) => event.args.includes('service_tier="priority"')));
    assert.ok(events.every((event) => event.path.startsWith(dirname(realpathSync(process.execPath)))));
    assert.ok(events.every((event) => event.zdotdir === join(realpathSync(outputDir), "shell-env")));
    assert.ok(events.every((event) => event.prompt.startsWith("Shared evidence packet\n\n")));
    assert.match(events.find((event) => event.name === "read_lane").prompt, /Authority: read-only/);
    assert.match(events.find((event) => event.name === "write_lane").prompt, /You own only: src\/example\.ts/);
    assert.equal(readFileSync(join(outputDir, "read_lane.md"), "utf8"), "code from read_lane\n");
    assert.ok(existsSync(join(outputDir, "summary.json")));
    assert.equal(summary.lanes[1].failureKind, "rate-limit");
    assert.ok(existsSync(join(outputDir, "shell-env", ".zshenv")));
    assert.match(readFileSync(join(outputDir, "reports.md"), "utf8"), /## read_lane[\s\S]*code from read_lane/);

    const launchPath = join(outputDir, "launch.json");
    const launchRecord = JSON.parse(readFileSync(launchPath, "utf8"));
    if (launchRecord.outputDir.startsWith("/private/var/")) {
      launchRecord.outputDir = launchRecord.outputDir.slice("/private".length);
      writeFileSync(launchPath, `${JSON.stringify(launchRecord, null, 2)}\n`);
    }

    const outsideReport = join(root, "outside.md");
    writeFileSync(outsideReport, "must not be drained\n");
    const resultPath = join(outputDir, "read_lane.result.json");
    const tamperedResult = JSON.parse(readFileSync(resultPath, "utf8"));
    tamperedResult.reportPath = outsideReport;
    writeFileSync(resultPath, `${JSON.stringify(tamperedResult, null, 2)}\n`);

    await assert.rejects(
      drainReports(outputDir, async () => {
        throw new Error("display failed");
      }),
      /display failed/,
    );
    let displayed = "";
    const firstDrain = await drainReports(outputDir, async (value) => {
      displayed += value;
    });
    assert.deepEqual(firstDrain.names, ["read_lane", "rate_limited", "write_lane"]);
    assert.match(displayed, /## read_lane[\s\S]*code from read_lane/);
    assert.match(displayed, /## write_lane[\s\S]*code from write_lane/);
    assert.doesNotMatch(displayed, /must not be drained/);
    const secondDrain = await drainReports(outputDir, async () => {
      assert.fail("seen reports must not be emitted twice");
    });
    assert.equal(secondDrain.count, 0);
  } finally {
    if (previousEvents === undefined) delete process.env.LUNA_FAKE_EVENTS;
    else process.env.LUNA_FAKE_EVENTS = previousEvents;
  }
});

test("rejects ambiguous or unsafe lane manifests before launch", () => {
  const root = scratch();
  assert.throws(
    () => normalizeManifest({ lanes: [{ name: "same", prompt: "one", workdir: root }, { name: "same", prompt: "two", workdir: root }] }),
    /duplicate lane name/,
  );
  assert.throws(
    () => normalizeManifest({ lanes: [{ name: "write", prompt: "edit", workdir: root, sandbox: "workspace-write" }] }),
    /must declare ownedPaths/,
  );
  assert.throws(
    () => normalizeManifest({ lanes: [{ name: "relative", prompt: "inspect", workdir: "." }] }),
    /must be an absolute path/,
  );
  assert.throws(
    () =>
      normalizeManifest({
        lanes: [
          {
            name: "newline_path",
            prompt: "edit",
            workdir: root,
            sandbox: "workspace-write",
            ownedPaths: ["src/one.ts\nsrc/two.ts"],
          },
        ],
      }),
    /single-line paths/,
  );
  assert.throws(
    () => parseArgs(["--manifest", "/tmp/one.json", "--manifest", "/tmp/two.json"]),
    /Duplicate argument/,
  );

  const ranked = (count) =>
    Array.from({ length: count }, (_, index) => ({
      name: `rank_${String(index + 1).padStart(2, "0")}`,
      task: `Return ${index + 1}`,
    }));
  assert.equal(normalizeManifest({ workdir: root, lanes: ranked(75) }).length, 75);
  assert.throws(() => normalizeManifest({ workdir: root, lanes: [] }), /at least one lane/);

  const instructionsPath = join(root, "quick-instructions.md");
  writeFileSync(instructionsPath, "Shared packet");
  const direct = { workdir: root, instructions_file: instructionsPath };
  const quick = quickManifest({
    count: "50",
    ...direct,
  });
  assert.equal(quick.lanes.length, 50);
  assert.equal(quick.maxActive, undefined);
  assert.equal(quick.startIntervalMs, 1_000);
  assert.deepEqual(quick.lanes[0], {
    name: "luna_01",
    task: "You are investigator 1 of 50. Follow the shared instructions and return the requested report.",
  });
  assert.equal(quick.lanes[49].name, "luna_50");
  assert.throws(() => quickManifest({ count: "9007199254740992", ...direct }), /positive integer/);

  const tasksPath = join(root, "tasks.json");
  writeFileSync(
    tasksPath,
    JSON.stringify([
      { name: "receipts", task: "Audit receipt identity and cite the deciding rows." },
      { name: "runtime", task: "Audit runtime failures and classify non-results." },
    ]),
  );
  const described = quickManifest({
    tasks_file: tasksPath,
    ...direct,
  });
  assert.deepEqual(described.lanes, [
    { name: "receipts", task: "Audit receipt identity and cite the deciding rows." },
    { name: "runtime", task: "Audit runtime failures and classify non-results." },
  ]);
  writeFileSync(tasksPath, JSON.stringify(["same task", "same task"]));
  assert.throws(
    () =>
      quickManifest({
        tasks_file: tasksPath,
        ...direct,
      }),
    /duplicate task description/,
  );

  writeFileSync(
    tasksPath,
    JSON.stringify(Array.from({ length: 75 }, (_, index) => `Distinct investigation ${index + 1}`)),
  );
  const paced = quickManifest({
    tasks_file: tasksPath,
    max_active: "7",
    ...direct,
  });
  assert.equal(paced.maxActive, "7");
  assert.equal(paced.startIntervalMs, 1_000);
});

test("tasks-file CLI reports progress and obeys its pace and active cap", () => {
  const root = scratch();
  const outputDir = join(root, "quick-output");
  const eventsPath = join(root, "quick-events.jsonl");
  const instructionsPath = join(root, "shared.md");
  const tasksPath = join(root, "tasks.json");
  writeFileSync(instructionsPath, "One shared investigation packet.");
  writeFileSync(
    tasksPath,
    JSON.stringify(
      Array.from({ length: 4 }, (_, index) => ({
        name: `angle_${String(index + 1).padStart(2, "0")}`,
        task: `Audit independent angle ${index + 1} and return exact evidence.`,
      })),
    ),
  );

  const launch = runCli(
    ["--tasks-file", tasksPath, "--max-active", "2", "--start-interval-ms", "50", "--workdir", root,
      "--instructions-file", instructionsPath, "--codex-bin", fakeCodex(root), "--output-dir", outputDir],
    { LUNA_FAKE_EVENTS: eventsPath },
  );
  assert.equal(launch.status, 0, launch.stderr);
  const output = launch.stdout.trim().split("\n").map(JSON.parse);
  assert.deepEqual(output.map(({ type }) => type), [
    "luna_lanes.started",
    ...Array(4).fill("luna_lane.finished"),
    "luna_lanes.completed",
  ]);
  assert.equal(output.at(-1).completedCount, 4);
  assert.equal(output.at(-1).failedCount, 0);
  const events = readFileSync(eventsPath, "utf8").trim().split("\n").map(JSON.parse);
  const starts = events.filter((event) => event.event === "start");
  const summary = JSON.parse(readFileSync(join(outputDir, "summary.json"), "utf8"));
  assert.ok(Date.parse(summary.lanes[1].startedAt) - Date.parse(summary.lanes[0].startedAt) >= 45);
  assert.ok(Date.parse(summary.lanes[2].startedAt) >= Math.min(...summary.lanes.slice(0, 2).map(({ finishedAt }) => Date.parse(finishedAt))));
  assert.match(starts.find((event) => event.name === "angle_01").prompt, /Audit independent angle 1/);
  assert.match(starts.find((event) => event.name === "angle_04").prompt, /Audit independent angle 4/);
  assert.ok(starts.every((event) => event.prompt.startsWith("One shared investigation packet.\n\n")));
});

test("CLI announces the output directory and drains each report once", () => {
  const root = scratch();
  const outputDir = join(root, "cli-output");
  const manifestPath = join(root, "manifest.json");
  const eventsPath = join(root, "cli-events.jsonl");
  const parentId = `test_launch_only_${process.pid}_${Math.random().toString(16).slice(2)}`;
  const registryPath = join(tmpdir(), "codex-luna-swarm", `${parentId}.json`);
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      workdir: root,
      instructions: "Return a concise report.",
      lanes: [
        { name: "first", task: "Inspect the first concern." },
        { name: "second", task: "Inspect the second concern." },
      ],
    })}\n`,
  );

  const launch = runCli(
    ["--manifest", manifestPath, "--launch-only", "--codex-bin", fakeCodex(root), "--output-dir", outputDir],
    { LUNA_FAKE_EVENTS: eventsPath, CODEX_THREAD_ID: parentId },
  );
  assert.equal(launch.status, 0, launch.stderr);
  const started = JSON.parse(launch.stdout.split("\n", 1)[0]);
  assert.equal(started.type, "luna_lanes.started");
  assert.equal(started.outputDir, realpathSync(outputDir));
  assert.equal(started.laneCount, 2);
  assert.equal(started.launchOnly, true);
  assert.equal(existsSync(registryPath), false);
  assert.equal(JSON.parse(readFileSync(join(outputDir, "summary.json"), "utf8")).launchOnly, true);

  const firstDrain = runCli(["--drain", outputDir]);
  assert.equal(firstDrain.status, 0, firstDrain.stderr);
  assert.match(firstDrain.stdout, /## first[\s\S]*code from first/);
  assert.match(firstDrain.stdout, /## second[\s\S]*code from second/);

  const secondDrain = runCli(["--drain", outputDir]);
  assert.equal(secondDrain.status, 0, secondDrain.stderr);
  assert.equal(secondDrain.stdout, "");
});

test("Stop hook continues only the parent and wakes it after terminal or crash", () => {
  const root = scratch();
  const registry = join(tmpdir(), "codex-luna-swarm");
  mkdirSync(registry, { recursive: true, mode: 0o700 });
  const invoke = (terminal = false, pid = process.pid, env = {}) => {
    const id = `test_hook_${process.pid}_${Math.random().toString(16).slice(2)}`;
    const path = join(registry, `${id}.json`);
    const outputDir = join(root, id);
    mkdirSync(outputDir);
    if (terminal) writeFileSync(join(outputDir, "summary.json"), "{}");
    writeFileSync(path, JSON.stringify({ threadId: id, pid, outputDir }));
    const result = runCli(["--stop-hook"], env, JSON.stringify({ session_id: id }));
    assert.equal(result.status, 0, result.stderr);
    return { path, result: JSON.parse(result.stdout) };
  };
  const active = invoke();
  assert.match(active.result.reason, /is active/);
  const child = runCli(["--stop-hook"], { CODEX_LUNA_LANE: "1" }, "{}");
  assert.deepEqual(JSON.parse(child.stdout), {});
  rmSync(active.path, { force: true });
  const terminal = invoke(true);
  assert.match(terminal.result.reason, /finished/);
  assert.equal(existsSync(terminal.path), false);
  const crashed = invoke(false, 999_999_999);
  assert.match(crashed.result.reason, /stopped unexpectedly/);
  assert.equal(existsSync(crashed.path), false);
});
