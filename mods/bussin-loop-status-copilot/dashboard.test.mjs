import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { snapshot, discover, control, validateRoot } from "./loop-data.mjs";
import { startServer, stopServer } from "./server.mjs";

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), "autoloop-dashboard-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, ".loop", "logs"), { recursive: true });
    const put = async (name, data) => writeFile(join(root, ".loop", name), typeof data === "string" ? data : JSON.stringify(data));
    await put("feature_list.json", { features: [
        { id: "F1", description: "First", passes: true },
        { id: "F2", description: "<img src=x onerror=alert(1)>", passes: false, depends_on: ["F1"] },
        { id: "F3", description: "Third", passes: false, depends_on: ["F2"] },
    ] });
    await put("live.json", { state: "running", agent: "copilot", updated_at: Date.now() / 1000,
        started_at: Date.now() / 1000 - 120, workers: 1, running: [{ item: "F2", worker: 1, started_at: Date.now() / 1000 - 10 }],
        machine: { sessions: 5, in_use: 2 } });
    await put("usage.jsonl", `${JSON.stringify({ item: "F1", agent: "copilot", duration_ms: 60000, premium_requests: 1, input_tokens: 0 })}\n{incomplete\n`);
    await put("logs/F2.log", "12:00\timplement\tedit\tWriting UI\n12:01\tgate\ttool\tRunning checks\n");
    return { root, put };
}

test("live artifacts, step logs, dependencies, ETA and honest Copilot usage", async t => {
    const { root } = await fixture(t);
    const result = await snapshot(root);
    assert.equal(result.done, 1);
    assert.equal(result.total, 3);
    assert.equal(result.state, "running");
    assert.equal(result.current[0].step, "gate");
    assert.equal(result.current[0].logs.length, 2);
    assert.deepEqual(result.next[0].waiting, ["F2"]);
    assert.equal(result.eta, 120);
    assert.equal(result.usage.input, null);
    assert.equal(result.usage.cost, null);
    assert.equal(result.usage.premium, 1);
    assert.equal(result.machine.in_use, 2);
    assert.match(result.warnings[0], /invalid usage/);
});

test("driver exit, graceful stop, rename and invalid writes", async t => {
    const { root, put } = await fixture(t);
    await control(root, "stop");
    assert.equal((await snapshot(root)).state, "stopping");
    assert.equal(await readFile(join(root, ".loop", "stop"), "utf8"), "");
    await control(root, "rename", "My loop");
    assert.equal((await snapshot(root)).name, "My loop");
    await assert.rejects(control(root, "rename", "bad\nname"), /control characters/);
    await assert.rejects(control(root, "run"), /Unknown/);
    await put("live.json", { state: "running", pid: 2147483647 });
    const state = await snapshot(root);
    assert.equal(state.state, "stopped");
    assert.ok(state.warnings.some(w => /Driver exited/.test(w)));
    assert.deepEqual(state.current, []);
});

test("bounded files, corrupt contracts, no symlink writes or relative roots", async t => {
    const { root, put } = await fixture(t);
    await assert.rejects(validateRoot("relative/path"), /absolute/);
    await put("feature_list.json", "{broken");
    await assert.rejects(snapshot(root), SyntaxError);
    await put("feature_list.json", "x".repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(snapshot(root), /exceeds/);
    const target = join(root, "untouched");
    await writeFile(target, "original");
    await symlink(target, join(root, ".loop", "name"));
    await assert.rejects(control(root, "rename", "changed"));
    assert.equal(await readFile(target, "utf8"), "original");
});

test("exact telemetry truncation boundary, blocked notes and optional artifacts", async t => {
    const { root, put } = await fixture(t);
    await put("live.json", {});
    await put("progress.md", "Blocked: F2 waiting for credentials\n");
    const row = '{"item":"F1","agent":"claude","cost_usd":0.2,"input_tokens":3}\n';
    await put("usage.jsonl", row);
    let result = await snapshot(root);
    assert.equal(result.state, "idle");
    assert.equal(result.next[0].blocked, true);
    assert.equal(result.usage.input, 3);
    assert.equal(result.usage.partial, false);
    const limit = 2 * 1024 * 1024;
    await put("usage.jsonl", " ".repeat(limit - row.length) + row);
    assert.equal((await snapshot(root)).usage.partial, false);
    await put("usage.jsonl", " ".repeat(limit) + "\n" + row);
    result = await snapshot(root);
    assert.equal(result.usage.partial, true);
    assert.equal(result.usage.sessions, 1);
    assert.equal(result.usage.cost, 0.2);
    await put("feature_list.json", { features: [{ id: "F1", passes: true }] });
    assert.equal((await snapshot(root)).state, "finished");
});

test("discovery is limited to selected root and its registered Git worktrees", async t => {
    const { root } = await fixture(t);
    const worktree = join(root, "other");
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "Fixture"]);
    execFileSync("git", ["-C", root, "worktree", "add", "-qb", "fixture", worktree], { stdio: "pipe" });
    await mkdir(join(worktree, ".loop"));
    await writeFile(join(worktree, ".loop", "feature_list.json"), '{"features":[]}');
    const result = await discover([root]);
    assert.deepEqual(new Set(result.paths), new Set([await validateRoot(root), await validateRoot(worktree)]));
    assert.deepEqual(result.errors, []);
});

test("HTTP controls require token, matching origin/host, selected loop and persist sources", async t => {
    const { root } = await fixture(t);
    const entry = await startServer("test", { artifacts: join(root, "artifacts") });
    t.after(() => stopServer("test"));
    const api = (path, data, headers = {}) => fetch(`${entry.origin}${path}`, {
        method: data ? "POST" : "GET",
        headers: { "x-autoloop-token": entry.token, ...(data ? { "Content-Type": "application/json" } : {}), ...headers },
        ...(data ? { body: JSON.stringify(data) } : {}),
    });
    assert.equal(entry.server.address().address, "127.0.0.1");
    assert.equal((await fetch(`${entry.origin}/api/state`)).status, 403);
    assert.equal((await api("/api/root", { path: root }, { Origin: "https://evil.invalid" })).status, 403);
    assert.equal((await api("/api/root", { path: root }, { Origin: "null" })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
        const req = httpRequest(`${entry.origin}/api/state`, { headers: { Host: "evil.invalid", "x-autoloop-token": entry.token } }, res => {
            res.resume(); resolve(res.statusCode);
        });
        req.on("error", reject); req.end();
    });
    assert.equal(badHostStatus, 403);
    const added = await api("/api/root", { path: root });
    assert.equal(added.status, 200);
    assert.equal((await added.json()).loops.length, 1);
    assert.equal(JSON.parse(await readFile(join(root, "artifacts", "roots.json"), "utf8")).length, 1);
    assert.equal((await api("/api/control", { path: "/", action: "stop" })).status, 400);
    assert.equal((await api("/api/control", { path: await validateRoot(root), action: "stop" })).status, 200);
    assert.equal((await api("/api/control", { path: await validateRoot(root), action: "rename", name: "HTTP loop" })).status, 200);
    assert.equal((await api("/api/state")).status, 200);
    await writeFile(join(root, ".loop", "feature_list.json"), '{"features":[{"id":"F1","passes":true}]}');
    const refreshed = await api("/api/state");
    assert.equal((await refreshed.json()).loops[0].total, 1);
    const page = await fetch(entry.origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
    assert.match(await page.text(), /<html lang="en">/);
    assert.equal((await fetch(`${entry.origin}/loop-data.mjs`)).status, 404);
    await stopServer("test");
    const second = await startServer("test-2", { artifacts: join(root, "artifacts") });
    t.after(() => stopServer("test-2"));
    const state = await fetch(`${second.origin}/api/state`, { headers: { "x-autoloop-token": second.token } });
    assert.equal((await state.json()).loops[0].name, "HTTP loop");
});
