import { open, realpath, stat, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_FILE = 2 * 1024 * 1024;
const gitArgs = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

async function text(path, tail = false) {
    let file;
    try {
        file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const info = await file.stat();
        if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
        if (!tail && info.size > MAX_FILE) throw new Error(`Artifact exceeds 2 MB: ${path}`);
        const length = Math.min(info.size, MAX_FILE);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await file.read(buffer, 0, length, tail ? Math.max(0, info.size - length) : 0);
        const result = buffer.subarray(0, bytesRead).toString("utf8");
        return tail && info.size > length ? result.slice(result.indexOf("\n") + 1) : result;
    } catch (error) {
        if (error.code === "ENOENT") return "";
        throw error;
    } finally { await file?.close(); }
}

async function artifact(path, fallback) {
    const value = await text(path);
    return value.trim() ? JSON.parse(value) : fallback;
}

export async function validateRoot(value) {
    if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0") || value.length > 4096) {
        throw new Error("Enter an absolute directory path.");
    }
    const path = await realpath(value);
    if (!(await stat(path)).isDirectory()) throw new Error("Source must be a directory.");
    return path;
}

export async function discover(roots) {
    const paths = new Set();
    const errors = [];
    for (const root of roots) {
        try {
            const canonical = await validateRoot(root);
            let candidates = [canonical];
            try {
                const { stdout } = await exec("git", [...gitArgs, "-C", canonical, "worktree", "list", "--porcelain", "-z"],
                    { timeout: 5000, maxBuffer: 1024 * 1024 });
                candidates = [...candidates, ...stdout.split("\0").filter(s => s.startsWith("worktree ")).map(s => s.slice(9))];
            } catch (error) {
                if (!String(error.stderr).includes("not a git repository")) {
                    errors.push(`${root}: worktree discovery failed: ${error.message}`);
                }
            }
            for (const candidate of candidates) {
                const path = await realpath(candidate);
                try {
                    const loop = await lstat(join(path, ".loop"));
                    if (!loop.isDirectory() || loop.isSymbolicLink()) throw new Error("Symlinked .loop directories are not supported.");
                    if ((await lstat(join(path, ".loop", "feature_list.json"))).isFile()) paths.add(path);
                } catch (error) {
                    if (error.code !== "ENOENT") errors.push(`${path}: ${error.message}`);
                }
            }
        } catch (error) { errors.push(`${root}: ${error.message}`); }
    }
    if (paths.size > 100) errors.push("More than 100 loops discovered; only the first 100 are displayed.");
    return { paths: [...paths].slice(0, 100), errors };
}

async function driver(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return "unknown";
    try {
        const { stdout } = await exec("ps", ["-p", String(pid), "-o", "command="], { timeout: 3000 });
        return /(^|[\s/])loop\.sh(\s|$)/.test(stdout) ? "alive" : "exited";
    } catch (error) {
        if (error.code === 1) return "exited";
        return "unknown";
    }
}

export async function snapshot(path) {
    const directory = join(path, ".loop");
    const list = await artifact(join(directory, "feature_list.json"), {});
    if (!Array.isArray(list.features)) throw new Error("feature_list.json needs a features array.");
    const [live, config, name, usageText, progress, attempts, usageInfo] = await Promise.all([
        artifact(join(directory, "live.json"), {}), artifact(join(directory, "config.json"), {}),
        text(join(directory, "name")), text(join(directory, "usage.jsonl"), true),
        text(join(directory, "progress.md"), true), artifact(join(directory, "attempts.json"), {}),
        lstat(join(directory, "usage.jsonl")).catch(error => {
            if (error.code === "ENOENT") return { size: 0 };
            throw error;
        }),
    ]);
    const warnings = [];
    const usage = usageText.split("\n").filter(Boolean).flatMap(line => {
        try { const row = JSON.parse(line); return row && typeof row.item === "string" ? [row] : []; }
        catch { warnings.push("An incomplete or invalid usage row was skipped."); return []; }
    });
    const features = list.features.filter(f => f && typeof f.id === "string");
    const passed = new Set(features.filter(f => f.passes === true).map(f => f.id));
    const now = Date.now() / 1000;
    const driverState = await driver(live.pid);
    let stop = false;
    try { await lstat(join(directory, "stop")); stop = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const active = ["running", "queued", "stopping"].includes(live.state);
    const stale = active && driverState === "unknown" && Number.isFinite(live.updated_at) && now - live.updated_at > 900;
    const exited = active && driverState === "exited";
    if (exited) warnings.push("Driver exited. Restart loop.sh manually to resume; no process will be started here.");
    if (stale) warnings.push("No live update for 15 minutes; driver status is unknown.");
    let state = ["running", "queued", "stopping", "finished", "stopped"].includes(live.state)
        ? live.state : features.length > 0 && passed.size === features.length ? "finished" : "idle";
    if (exited) state = "stopped";
    if (stop && state === "running") state = "stopping";
    const running = ["running", "stopping"].includes(state) && Array.isArray(live.running) ? live.running : [];
    const current = await Promise.all(running.slice(0, 8).map(async r => {
        const f = features.find(f => f.id === r.item) || { id: r.item, description: r.item };
        const safe = typeof r.item === "string" && /^[A-Za-z0-9._-]+$/.test(r.item);
        const lines = safe ? (await text(join(directory, "logs", `${r.item}.log`), true)).trim().split("\n").filter(Boolean) : [];
        const logs = lines.slice(-40).map(line => line.split("\t"));
        const steps = ["orient", "implement", "gate", "review", "browser", "commit"];
        return { ...f, worker: r.worker, elapsed: Number.isFinite(r.started_at) ? Math.max(0, now - r.started_at) : null,
            attempt: attempts[r.item] ?? null, step: logs.map(l => l[1]).filter(s => steps.includes(s)).at(-1) || "orient",
            logs: logs.slice(-6) };
    }));
    const blocked = new Set(progress.split("\n").map(line => line.match(/^Blocked:\s*(\S+)/)?.[1]).filter(Boolean));
    const pending = features.filter(f => !passed.has(f.id) && !current.some(r => r.id === f.id)).map(f => ({
        ...f, waiting: (Array.isArray(f.depends_on) ? f.depends_on : []).filter(id => !passed.has(id)),
        blocked: blocked.has(f.id),
        attempts: attempts[f.id] ?? null,
    }));
    const sum = key => {
        const values = usage.map(u => u[key]).filter(Number.isFinite);
        return values.length ? values.reduce((a, b) => a + b, 0) : null;
    };
    const completed = new Set(usage.filter(u => passed.has(u.item)).map(u => u.item)).size;
    const duration = sum("duration_ms");
    const remaining = features.length - passed.size;
    const workers = Math.max(1, Math.min(Number(live.workers) || 1, remaining || 1, 8));
    const eta = state === "running" && completed && duration !== null && remaining
        ? duration / 1000 / completed * remaining / workers : null;
    const copilotUsage = usage.some(u => u.agent === "copilot") || live.agent === "copilot";
    const first = live.started_at ?? usage[0]?.started_at;
    const last = active && !exited ? now : live.updated_at ?? usage.at(-1)?.ended_at;
    return {
        path, name: name.trim().slice(0, 80) || config.name || config.task?.split(". ")[0] || basename(path),
        task: config.task || list.task || "", state, driver: driverState, warnings: [...new Set(warnings)],
        mode: live.mode || "sequential", agent: live.agent || config.agent || "unknown",
        done: passed.size, total: features.length, current, next: pending.slice(0, 20),
        recent: usage.slice(-8).reverse(), notes: progress.split("\n").filter(l => l.startsWith("## ")).slice(-3),
        machine: live.machine || null, eta, elapsed: Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : null,
        usage: { sessions: usage.length, partial: usageInfo.size > MAX_FILE,
            cost: sum("cost_usd"), unpriced: usage.filter(u => !Number.isFinite(u.cost_usd)).length,
            input: copilotUsage ? null : sum("input_tokens"), output: copilotUsage ? null : sum("output_tokens"),
            cacheRead: copilotUsage ? null : sum("cache_read_tokens"), cacheWrite: copilotUsage ? null : sum("cache_write_tokens"),
            premium: sum("premium_requests"), models: [...new Set(usage.flatMap(u => Object.keys(u.models || {})))] },
    };
}

export async function control(path, action, name) {
    if (!["stop", "rename"].includes(action)) throw new Error("Unknown loop action.");
    if (action === "rename" && (typeof name !== "string" || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name))) {
        throw new Error("Name must contain 1-80 characters without control characters.");
    }
    const directory = join(path, ".loop");
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("Refusing symlinked loop directory.");
    const filename = action === "stop" ? "stop" : "name";
    const file = await open(join(directory, filename),
        constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
        if (!(await file.stat()).isFile()) throw new Error("Control target is not a regular file.");
        await file.truncate(0);
        await file.writeFile(action === "stop" ? "" : `${name.trim()}\n`);
    } finally { await file.close(); }
}
