import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { installBlock, parseArgs, removeBlock, runInstaller } from "../scripts/install.mjs";

const roots = [];

function repository() {
  const root = mkdtempSync(join(tmpdir(), "codex-luna-install-test-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", root]);
  return root;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("installs, checks, updates, and removes only managed paths", () => {
  const root = repository();
  const agentsPath = join(root, "AGENTS.md");
  writeFileSync(agentsPath, "# Existing rules\n\nKeep this text.\n");

  const installed = runInstaller({ target: root, mode: "install", force: false });
  assert.equal(installed.status, "installed");
  assert.ok(existsSync(join(root, ".agents", "skills", "codex-luna-swarm", "SKILL.md")));
  assert.ok(existsSync(join(root, ".codex", "agents", "luna_worker.toml")));
  const firstAgents = readFileSync(agentsPath, "utf8");
  assert.match(firstAgents, /# Existing rules/);
  assert.match(firstAgents, /codex-luna-swarm:start/);
  assert.equal((firstAgents.match(/codex-luna-swarm:start/g) ?? []).length, 1);

  assert.equal(runInstaller({ target: root, mode: "check", force: false }).status, "ok");
  runInstaller({ target: root, mode: "install", force: false });
  assert.equal(readFileSync(agentsPath, "utf8"), firstAgents);

  const agentPath = join(root, ".codex", "agents", "luna_worker.toml");
  writeFileSync(agentPath, "user-owned = true\n");
  assert.throws(
    () => runInstaller({ target: root, mode: "install", force: false }),
    /custom agent differs/,
  );
  runInstaller({ target: root, mode: "install", force: true });
  assert.doesNotMatch(readFileSync(agentPath, "utf8"), /user-owned/);

  writeFileSync(agentsPath, firstAgents.replace("When the operator", "When a maintainer"));
  assert.throws(
    () => runInstaller({ target: root, mode: "remove", force: false }),
    /managed AGENTS\.md block differs/,
  );
  runInstaller({ target: root, mode: "install", force: true });

  runInstaller({ target: root, mode: "remove", force: false });
  assert.equal(readFileSync(agentsPath, "utf8"), "# Existing rules\n\nKeep this text.\n");
  assert.equal(existsSync(join(root, ".agents", "skills", "codex-luna-swarm")), false);
  assert.equal(existsSync(agentPath), false);
});

test("managed block helpers preserve surrounding text and reject broken markers", () => {
  const snippet = "<!-- codex-luna-swarm:start -->\nnew\n<!-- codex-luna-swarm:end -->";
  const installed = installBlock("before\n", snippet);
  assert.equal(removeBlock(installed), "before\n");
  assert.throws(
    () => installBlock("<!-- codex-luna-swarm:start -->\nbroken\n", snippet),
    /incomplete/,
  );
  assert.throws(
    () => installBlock(`${snippet}\n<!-- codex-luna-swarm:end -->\n`, snippet),
    /more than one/,
  );
  assert.throws(() => parseArgs(["--target", "relative"]), /absolute path/);
  assert.throws(() => parseArgs(["--target", "/tmp", "--check", "--force"]), /does not accept/);
});
