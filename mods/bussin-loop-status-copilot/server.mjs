import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { discover, snapshot, control, validateRoot } from "./loop-data.mjs";

// Loopback lifecycle and request-token pattern adapted from GitHub's MIT canvas example.
const instances = new Map();
const artifacts = join(process.env.COPILOT_HOME || join(homedir(), ".copilot"),
    "extensions", "bussin-autoloop-dashboard", "artifacts");
let persistence = Promise.resolve();

function json(res, status, value) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
}

async function body(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) throw new Error("Request too large.");
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const limits = { roots: 30, hidden: 200 };

async function listFromDisk(directory, name) {
    try {
        const value = JSON.parse(await readFile(join(directory, `${name}.json`), "utf8"));
        if (!Array.isArray(value) || value.length > limits[name] || value.some(v => typeof v !== "string")) {
            throw new Error(`Invalid saved ${name}. Expected at most ${limits[name]} paths.`);
        }
        return value;
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
}

async function writeList(directory, name, list) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `${name}-${randomBytes(8).toString("hex")}.tmp`);
    await writeFile(temporary, JSON.stringify(list), { mode: 0o600 });
    await rename(temporary, join(directory, `${name}.json`));
}

function serialize(work) {
    const operation = persistence.then(work);
    persistence = operation.catch(() => {});
    return operation;
}

// Adding a source again is the undo for Remove: it unhides the root and its worktree loops.
async function saveRoot(entry, root, reveal = true) {
    await serialize(async () => {
        const roots = await listFromDisk(entry.artifacts, "roots");
        const updated = [...new Set([...roots, root])];
        if (updated.length > limits.roots) throw new Error(`Maximum of ${limits.roots} selected repositories reached.`);
        if (updated.length !== roots.length) await writeList(entry.artifacts, "roots", updated);
        const hidden = await listFromDisk(entry.artifacts, "hidden");
        if (!reveal || !hidden.length) return;
        const revealed = new Set([root, ...(await discover([root])).paths]);
        const kept = hidden.filter(path => !revealed.has(path));
        if (kept.length !== hidden.length) await writeList(entry.artifacts, "hidden", kept);
    });
}

async function hideLoop(entry, path) {
    await serialize(async () => {
        const hidden = await listFromDisk(entry.artifacts, "hidden");
        if (hidden.includes(path)) return;
        if (hidden.length >= limits.hidden) throw new Error(`Maximum of ${limits.hidden} removed loops reached.`);
        await writeList(entry.artifacts, "hidden", [...hidden, path]);
    });
}

async function refresh(entry) {
    if (entry.pending) return entry.pending;
    entry.pending = (async () => {
        const [roots, hidden] = await Promise.all([
            listFromDisk(entry.artifacts, "roots"), listFromDisk(entry.artifacts, "hidden")]);
        const { paths: found, errors } = await discover(roots);
        const paths = found.filter(path => !hidden.includes(path));
        const loops = await Promise.all(paths.map(async path => {
            try { return await snapshot(path); }
            catch (error) { return { path, name: path, error: error.message }; }
        }));
        entry.paths = new Set(paths);
        entry.snapshot = { gatheredAt: new Date().toISOString(), roots, hidden: hidden.length, errors, loops };
        return entry.snapshot;
    })();
    try { return await entry.pending; }
    finally { entry.pending = null; }
}

function authorized(req, entry) {
    return req.headers.host === entry.host
        && (!req.headers.origin || req.headers.origin === entry.origin)
        && (!req.headers["sec-fetch-site"] || ["same-origin", "none"].includes(req.headers["sec-fetch-site"]))
        && req.headers["x-autoloop-token"] === entry.token;
}

async function handle(req, res, entry) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
        const url = new URL(req.url, entry.origin);
        if (req.headers.host !== entry.host) return json(res, 403, { error: "Forbidden host." });
        if (url.pathname.startsWith("/api/")) {
            if (!authorized(req, entry)) return json(res, 403, { error: "Forbidden." });
            if (req.method === "GET" && url.pathname === "/api/state") {
                return json(res, 200, await refresh(entry));
            }
            if (req.method === "POST" && url.pathname === "/api/root") {
                const input = await body(req);
                const root = await validateRoot(input.path);
                await saveRoot(entry, root);
                return json(res, 200, await refresh(entry));
            }
            if (req.method === "POST" && url.pathname === "/api/control") {
                const input = await body(req);
                await refresh(entry);
                if (!entry.paths.has(input.path)) throw new Error("Select a discovered loop.");
                await control(input.path, input.action, input.name);
                return json(res, 200, await refresh(entry));
            }
            if (req.method === "POST" && url.pathname === "/api/remove") {
                const input = await body(req);
                await refresh(entry);
                if (!entry.paths.has(input.path)) throw new Error("Select a discovered loop.");
                await hideLoop(entry, input.path);
                return json(res, 200, await refresh(entry));
            }
            return json(res, 404, { error: "Not found." });
        }
        const assets = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"],
            "/format.mjs": ["format.mjs", "text/javascript"], "/styles.css": ["styles.css", "text/css"] };
        if (req.method !== "GET" || !assets[url.pathname]) return json(res, 404, { error: "Not found." });
        const [file, type] = assets[url.pathname];
        const content = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, {
            "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'",
        });
        res.end(content);
    } catch (error) { json(res, 400, { error: error.message }); }
}

export async function startServer(instanceId, options = {}) {
    const entry = instances.get(instanceId) || {
        token: randomBytes(32).toString("base64url"),
        artifacts: options.artifacts || artifacts, paths: new Set(),
    };
    if (options.projectPath) await saveRoot(entry, await validateRoot(options.projectPath), options.reveal !== false);
    if (entry.server) return entry;
    const server = createServer((req, res) => void handle(req, res, entry));
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    entry.server = server;
    entry.host = `127.0.0.1:${server.address().port}`;
    entry.origin = `http://${entry.host}`;
    entry.url = `${entry.origin}/?token=${entry.token}`;
    instances.set(instanceId, entry);
    return entry;
}

export async function refreshServer(instanceId) {
    const entry = instances.get(instanceId);
    if (!entry) throw new Error("Canvas is not open.");
    return refresh(entry);
}

export async function stopServer(instanceId) {
    const entry = instances.get(instanceId);
    if (!entry) return;
    instances.delete(instanceId);
    entry.server.closeAllConnections();
    await new Promise(resolve => entry.server.close(resolve));
}
