"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { after, test } = require("node:test");
const launcherPath = join(__dirname, "..", "skills", "codex-luna-swarm", "scripts", "luna-lanes.cjs");
const { drainReports, launchPolicy, normalizeManifest, parseArgs, quickManifest, runLunaLanes } = require(launcherPath);

const roots = [];

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "luna-lanes-test-"));
  roots.push(root);
  return root;
}

function fakeCodex(root) {
  const executable = join(root, "fake-codex.cjs");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
"use strict";
const { appendFileSync, basename, writeFileSync } = (() => {
  const fs = require("node:fs");
  const path = require("node:path");
  return { appendFileSync: fs.appendFileSync, writeFileSync: fs.writeFileSync, basename: path.basename };
})();
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
    if (process.env.LUNA_FAKE_RATE_LIMIT_NAME === name) {
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
        lanes: [
          { name: "read_lane", task: `Inspect $(touch ${marker})` },
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
          assert.equal(launch.lanes.length, 2);
          assert.ok(existsSync(join(outputDir, "launch.json")));
        },
      },
    );

    assert.deepEqual(
      summary.lanes.map(({ name, status, exitCode, threadId }) => ({ name, status, exitCode, threadId })),
      [
        { name: "read_lane", status: "completed", exitCode: 0, threadId: "thread-read_lane" },
        { name: "write_lane", status: "completed", exitCode: 0, threadId: "thread-write_lane" },
      ],
    );
    const events = readFileSync(eventsPath, "utf8").trim().split("\n").map(JSON.parse);
    const starts = events.filter((event) => event.event === "start").map((event) => event.at);
    const ends = events.filter((event) => event.event === "end").map((event) => event.at);
    assert.equal(starts.length, 2);
    assert.equal(ends.length, 2);
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
    assert.ok(existsSync(join(outputDir, "shell-env", ".zprofile")));
    const summaryRecord = JSON.parse(readFileSync(join(outputDir, "summary.json"), "utf8"));
    assert.equal(summaryRecord.runtime.nodeVersion, process.version);
    assert.equal(summaryRecord.runtime.userShellStartup, "isolated");
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
    assert.deepEqual(firstDrain.names, ["read_lane", "write_lane"]);
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

test("refuses an exact .nvmrc mismatch before spawning lanes", async () => {
  const root = scratch();
  const outputDir = join(root, "must-not-exist");
  writeFileSync(join(root, ".nvmrc"), "v0.0.1\n");
  await assert.rejects(
    runLunaLanes(
      { workdir: root, lanes: [{ name: "runtime", task: "Inspect the runtime." }] },
      { codexBin: fakeCodex(root), outputDir },
    ),
    /requires Node v0\.0\.1, but the Luna launcher runs/,
  );
  assert.equal(existsSync(outputDir), false);
});

test("classifies an HTTP 429 lane as a typed rate-limit non-result", async () => {
  const root = scratch();
  const outputDir = join(root, "rate-output");
  const eventsPath = join(root, "rate-events.jsonl");
  const previousEvents = process.env.LUNA_FAKE_EVENTS;
  const previousRateLimit = process.env.LUNA_FAKE_RATE_LIMIT_NAME;
  process.env.LUNA_FAKE_EVENTS = eventsPath;
  process.env.LUNA_FAKE_RATE_LIMIT_NAME = "limited";
  try {
    const finishEvents = [];
    const summary = await runLunaLanes(
      { workdir: root, lanes: [{ name: "limited", task: "Inspect the limited lane." }] },
      { codexBin: fakeCodex(root), outputDir, onLaneFinish: (event) => finishEvents.push(event) },
    );
    assert.equal(summary.lanes[0].status, "failed");
    assert.equal(summary.lanes[0].failureKind, "rate-limit");
    assert.equal(summary.lanes[0].error, "Codex lane was rate limited");
    assert.equal(finishEvents[0].failureKind, "rate-limit");
    assert.match(readFileSync(join(outputDir, "reports.md"), "utf8"), /Failure kind: rate-limit/);
  } finally {
    if (previousEvents === undefined) delete process.env.LUNA_FAKE_EVENTS;
    else process.env.LUNA_FAKE_EVENTS = previousEvents;
    if (previousRateLimit === undefined) delete process.env.LUNA_FAKE_RATE_LIMIT_NAME;
    else process.env.LUNA_FAKE_RATE_LIMIT_NAME = previousRateLimit;
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
  assert.equal(normalizeManifest({ stress: true, workdir: root, lanes: ranked(50) }).length, 50);
  assert.throws(
    () => normalizeManifest({ workdir: root, lanes: ranked(16) }),
    /with stress: true/,
  );
  assert.throws(
    () => normalizeManifest({ stress: true, workdir: root, lanes: ranked(51) }),
    /with stress: true/,
  );

  const instructionsPath = join(root, "quick-instructions.md");
  writeFileSync(instructionsPath, "Shared packet");
  const quick = quickManifest({
    count: "50",
    stress: true,
    workdir: root,
    instructions_file: instructionsPath,
  });
  assert.equal(quick.lanes.length, 50);
  assert.equal(quick.maxActive, undefined);
  assert.equal(quick.startIntervalMs, 0);
  assert.deepEqual(quick.lanes[0], {
    name: "luna_01",
    task: "You are investigator 1 of 50. Follow the shared instructions and return the requested report.",
  });
  assert.equal(quick.lanes[49].name, "luna_50");
  assert.throws(
    () => quickManifest({ count: "50", stress: false, workdir: root, instructions_file: instructionsPath }),
    /requires --stress/,
  );

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
    stress: false,
    workdir: root,
    instructions_file: instructionsPath,
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
        stress: false,
        workdir: root,
        instructions_file: instructionsPath,
      }),
    /duplicate task description/,
  );

  writeFileSync(
    tasksPath,
    JSON.stringify(Array.from({ length: 50 }, (_, index) => `Distinct investigation ${index + 1}`)),
  );
  const paced = quickManifest({
    tasks_file: tasksPath,
    stress: true,
    max_active: "7",
    workdir: root,
    instructions_file: instructionsPath,
  });
  assert.equal(paced.maxActive, "7");
  assert.equal(paced.startIntervalMs, 1_000);
  assert.deepEqual(launchPolicy(paced, 50), { maxActive: 7, startIntervalMs: 1_000 });
  assert.throws(() => launchPolicy({ maxActive: "51" }, 50), /maxActive must be an integer from 1 to 50/);
});

test("tasks-file CLI launches 50 individually described Luna lanes from one shared packet", () => {
  const root = scratch();
  const outputDir = join(root, "quick-output");
  const eventsPath = join(root, "quick-events.jsonl");
  const instructionsPath = join(root, "shared.md");
  const tasksPath = join(root, "tasks.json");
  writeFileSync(instructionsPath, "One shared investigation packet.");
  writeFileSync(
    tasksPath,
    JSON.stringify(
      Array.from({ length: 50 }, (_, index) => ({
        name: `angle_${String(index + 1).padStart(2, "0")}`,
        task: `Audit independent angle ${index + 1} and return exact evidence.`,
      })),
    ),
  );

  const launch = spawnSync(
    process.execPath,
    [
      launcherPath,
      "--tasks-file",
      tasksPath,
      "--stress",
      "--start-interval-ms",
      "0",
      "--workdir",
      root,
      "--instructions-file",
      instructionsPath,
      "--codex-bin",
      fakeCodex(root),
      "--output-dir",
      outputDir,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, CODEX_THREAD_ID: "", LUNA_FAKE_EVENTS: eventsPath, LUNA_FAKE_DELAY: "3000" },
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(launch.status, 0, launch.stderr);
  const started = JSON.parse(launch.stdout.split("\n", 1)[0]);
  assert.equal(started.type, "luna_lanes.started");
  assert.equal(started.laneCount, 50);

  const finishEvents = launch.stdout
    .trim()
    .split("\n")
    .filter((line) => line.includes('"type":"luna_lane.finished"'))
    .map(JSON.parse);
  assert.equal(finishEvents.length, 50);
  assert.equal(finishEvents.at(-1).settledCount, 50);
  assert.equal(finishEvents.at(-1).remainingCount, 0);
  const terminalEvent = launch.stdout
    .trim()
    .split("\n")
    .filter((line) => line.includes('"type":"luna_lanes.completed"'))
    .map(JSON.parse)
    .at(-1);
  assert.equal(terminalEvent.completedCount, 50);
  assert.equal(terminalEvent.failedCount, 0);
  assert.equal(terminalEvent.rateLimitedCount, 0);
  assert.equal(terminalEvent.summaryPath, join(realpathSync(outputDir), "summary.json"));

  const events = readFileSync(eventsPath, "utf8").trim().split("\n").map(JSON.parse);
  const starts = events.filter((event) => event.event === "start");
  const ends = events.filter((event) => event.event === "end");
  assert.equal(starts.length, 50);
  assert.equal(ends.length, 50);
  assert.ok(Math.max(...starts.map((event) => event.at)) < Math.min(...ends.map((event) => event.at)));
  assert.match(starts.find((event) => event.name === "angle_01").prompt, /Audit independent angle 1/);
  assert.match(starts.find((event) => event.name === "angle_50").prompt, /Audit independent angle 50/);
  assert.ok(starts.every((event) => event.prompt.startsWith("One shared investigation packet.\n\n")));
});

test("paces starts and queues work behind an explicit active cap", async () => {
  const root = scratch();
  const outputDir = join(root, "paced-output");
  const eventsPath = join(root, "paced-events.jsonl");
  const previousEvents = process.env.LUNA_FAKE_EVENTS;
  process.env.LUNA_FAKE_EVENTS = eventsPath;
  try {
    const summary = await runLunaLanes(
      {
        workdir: root,
        stress: true,
        maxActive: 2,
        startIntervalMs: 50,
        lanes: Array.from({ length: 4 }, (_, index) => ({
          name: `paced_${index + 1}`,
          task: `Inspect paced angle ${index + 1}.`,
        })),
      },
      { codexBin: fakeCodex(root), outputDir },
    );
    const events = readFileSync(eventsPath, "utf8").trim().split("\n").map(JSON.parse);
    const starts = events.filter((event) => event.event === "start");
    const ends = events.filter((event) => event.event === "end");
    assert.equal(starts.length, 4);
    assert.equal(ends.length, 4);
    assert.ok(Date.parse(summary.lanes[1].startedAt) - Date.parse(summary.lanes[0].startedAt) >= 45);
    assert.ok(
      Date.parse(summary.lanes[2].startedAt) >=
        Math.min(Date.parse(summary.lanes[0].finishedAt), Date.parse(summary.lanes[1].finishedAt)),
    );
    const launch = JSON.parse(readFileSync(join(outputDir, "launch.json"), "utf8"));
    assert.equal(launch.maxActive, 2);
    assert.equal(launch.startIntervalMs, 50);
  } finally {
    if (previousEvents === undefined) delete process.env.LUNA_FAKE_EVENTS;
    else process.env.LUNA_FAKE_EVENTS = previousEvents;
  }
});

test("CLI announces the output directory and drains each report once", () => {
  const root = scratch();
  const outputDir = join(root, "cli-output");
  const manifestPath = join(root, "manifest.json");
  const eventsPath = join(root, "cli-events.jsonl");
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

  const launch = spawnSync(
    process.execPath,
    [launcherPath, "--manifest", manifestPath, "--codex-bin", fakeCodex(root), "--output-dir", outputDir],
    { encoding: "utf8", env: { ...process.env, CODEX_THREAD_ID: "", LUNA_FAKE_EVENTS: eventsPath } },
  );
  assert.equal(launch.status, 0, launch.stderr);
  const started = JSON.parse(launch.stdout.split("\n", 1)[0]);
  assert.equal(started.type, "luna_lanes.started");
  assert.equal(started.outputDir, realpathSync(outputDir));
  assert.equal(started.laneCount, 2);

  const firstDrain = spawnSync(process.execPath, [launcherPath, "--drain", outputDir], {
    encoding: "utf8",
  });
  assert.equal(firstDrain.status, 0, firstDrain.stderr);
  assert.match(firstDrain.stdout, /## first[\s\S]*code from first/);
  assert.match(firstDrain.stdout, /## second[\s\S]*code from second/);

  const secondDrain = spawnSync(process.execPath, [launcherPath, "--drain", outputDir], {
    encoding: "utf8",
  });
  assert.equal(secondDrain.status, 0, secondDrain.stderr);
  assert.equal(secondDrain.stdout, "");
});
