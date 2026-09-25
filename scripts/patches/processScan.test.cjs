"use strict";

/**
 * Run with `pnpm run test:patch` (node --test, no dependencies).
 *
 * The regression these cases exist for: `isAppProcess` used to accept any node process whose
 * command merely contained "9router" and "cli.js", which matched the *supervisor* — this repo
 * used to live at `…/hhosted-9router-dsh/node_modules/home-hosted/dist/cli.js` — so the
 * stale-process sweep SIGKILLed the panel that had just started the router.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectAppPids,
  isAppProcess,
  looksLikeNode,
  parseProcessTable,
  portOccupantToKill,
  ownProcessChain,
} = require("./processScan.cjs");

const PANEL = "node /home/mt/mine/hhosted-ai-pack/node_modules/.bin/../home-hosted/dist/cli.js up --foreground --home ./state";
const ROUTER = "node /home/mt/mine/hhosted-ai-pack/node_modules/.bin/../9router/cli.js -p 4397 -H 0.0.0.0 --no-browser --skip-update --log";

test("never claims the supervisor, even when the project folder is named after the router", () => {
  assert.equal(isAppProcess(PANEL), false);
  assert.equal(isAppProcess("node C:\\\\x\\\\hhosted-ai-pack\\\\node_modules\\\\home-hosted\\\\dist\\\\cli.js up --foreground"), false);
  // The folder name is irrelevant: only a real 9router package segment counts.
  assert.equal(isAppProcess("node /home/mt/mine/9router-stack/node_modules/home-hosted/dist/cli.js up --foreground"), false);
});

test("claims the router's own processes", () => {
  assert.equal(isAppProcess(ROUTER), true);
  assert.equal(isAppProcess("node ./node_modules/.bin/../9router/cli.js -p 4001 -H 127.0.0.1"), true);
  assert.equal(isAppProcess("node C:\\\\x\\\\node_modules\\\\9router\\\\cli.js -p 4300"), true);
  assert.equal(isAppProcess("node /pkg/9router/tray_linux.js"), true);
  assert.equal(isAppProcess("/pkg/next-server (v16.3.4)"), true);
});

test("ignores anything that is not a node process of ours", () => {
  assert.equal(isAppProcess("bash -c cd ~/mine/hhosted-ai-pack && cat state/.logs/9router.log"), false);
  assert.equal(isAppProcess("vim /pkg/node_modules/9router/cli.js"), false);
  assert.equal(isAppProcess(""), false);
  assert.equal(looksLikeNode("/usr/bin/node"), true);
  assert.equal(looksLikeNode("bash"), false);
});

test("collectAppPids skips the launcher's own process chain", () => {
  const processes = [
    { pid: 100, command: PANEL },
    { pid: 200, command: ROUTER },
    { pid: 300, command: ROUTER },
  ];
  const pids = collectAppPids({
    processes,
    readCommand: pid => (processes.find(entry => entry.pid === pid) || {}).command || null,
    // The panel launched the router, so it sits in the chain and must survive.
    exclude: new Set([100, 200]),
  });
  assert.deepEqual(pids, [300]);
});

test("parseProcessTable reads the pid column and skips headerless junk", () => {
  const rows = parseProcessTable([
    "  100 node /pkg/9router/cli.js -p 4300",
    "  200 bash -c echo 9router",
    "not a process line",
    "",
  ].join("\n"));
  assert.deepEqual(rows, [
    { pid: 100, command: "node /pkg/9router/cli.js -p 4300" },
    { pid: 200, command: "bash -c echo 9router" },
  ]);
});

test("collectAppPids re-checks every candidate, so a stray number can never become a kill", () => {
  // A wrapped `ps` continuation line can start with a number and still mention the router:
  // it parses as a candidate, and only the live re-read of that pid drops it.
  const rows = parseProcessTable("  4321 a wrapped continuation mentioning 9router\n  200 node /pkg/9router/cli.js");
  assert.deepEqual(rows.map(row => row.pid), [4321, 200]);

  const pids = collectAppPids({
    processes: rows,
    readCommand: pid => (pid === 200 ? "node /pkg/9router/cli.js" : null),
    exclude: new Set(),
  });
  assert.deepEqual(pids, [200]);
});

test("a port occupant in our own tree is left alone", () => {
  const chain = new Set([1, 10, 11]);
  assert.deepEqual(portOccupantToKill(11, chain), { pid: null, reason: "own-process-tree" });
  assert.deepEqual(portOccupantToKill(99, chain), { pid: 99, reason: "ok" });
  assert.deepEqual(portOccupantToKill(null, chain), { pid: null, reason: "none" });
  assert.equal(ownProcessChain(process.pid).has(process.pid), true);
});
