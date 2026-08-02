"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { after, test } = require("node:test");
const launcherPath = join(__dirname, "..", "skills", "codex-luna-swarm", "scripts", "luna-lanes.cjs");
const { drainReports, normalizeManifest, parseArgs, runLunaLanes } = require(launcherPath);

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
  const record = (event) => appendFileSync(process.env.LUNA_FAKE_EVENTS, JSON.stringify({ event, name, at: Date.now(), args, prompt }) + "\\n");
  record("start");
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-" + name }) + "\\n");
  setTimeout(() => {
    writeFileSync(reportPath, "code from " + name + "\\n");
    record("end");
    process.exit(0);
  }, 180);
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
    assert.ok(events.every((event) => event.prompt.startsWith("Shared evidence packet\n\n")));
    assert.match(events.find((event) => event.name === "read_lane").prompt, /Authority: read-only/);
    assert.match(events.find((event) => event.name === "write_lane").prompt, /You own only: src\/example\.ts/);
    assert.equal(readFileSync(join(outputDir, "read_lane.md"), "utf8"), "code from read_lane\n");
    assert.ok(existsSync(join(outputDir, "summary.json")));
    assert.match(readFileSync(join(outputDir, "reports.md"), "utf8"), /## read_lane[\s\S]*code from read_lane/);

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
    { encoding: "utf8", env: { ...process.env, LUNA_FAKE_EVENTS: eventsPath } },
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
