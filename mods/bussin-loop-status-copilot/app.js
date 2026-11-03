import { duration, status } from "/format.mjs";

const token = new URLSearchParams(location.search).get("token");
const $ = id => document.getElementById(id);
let selected = null, latest = null, pending = false, renaming = null, sourcesShown = false;
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = value => value == null ? "Unknown" : `$${value.toFixed(2)}`;
const number = value => value == null ? "Unknown" : value.toLocaleString();
function error(message) { $("error").hidden = !message; $("error").textContent = message || ""; }
async function request(path, data) {
    const response = await fetch(path, {
        method: data ? "POST" : "GET",
        headers: { "x-autoloop-token": token, ...(data ? { "Content-Type": "application/json" } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
}
function metric(label, value) { return `<div class="metric"><small>${label}</small><strong>${escape(value)}</strong></div>`; }
const now = () => Date.parse(latest?.gatheredAt) || Date.now();
const removeButton = '<button id="remove" type="button">Remove from dashboard</button>';
function details(loop) {
    if (loop.error) return `<section class="panel hero tone-alert"><div class="row heading"><h2>${escape(loop.name)}</h2>${removeButton}</div><p class="warning">${escape(loop.error)}</p><p class="path">${escape(loop.path)}</p></section>`;
    const canStop = ["running", "queued", "stopping"].includes(loop.state) && !loop.driverLost;
    const s = status(loop, now());
    return `<section class="panel hero tone-${s.tone}" aria-labelledby="loop-title">
        <div class="row heading"><h2 id="loop-title">${escape(loop.name)}</h2><div class="row"><button id="rename" type="button">Rename</button>${canStop ? '<button id="stop" type="button">Stop gracefully</button>' : ""}${removeButton}</div></div>
        <p class="status"><span class="badge">${escape(s.label)}</span> <strong>${escape(s.detail)}</strong></p>
        <label for="progress" class="progress-label"><strong>${loop.done} / ${loop.total}</strong> items done <strong>${s.percent}%</strong></label><progress id="progress" value="${loop.done}" max="${loop.total || 1}"></progress>
        <div class="metrics">${metric("Elapsed", duration(loop.elapsed))}${metric("Reported cost", money(loop.usage.cost))}</div>
        ${loop.warnings.map(w => `<p class="warning">${escape(w)}</p>`).join("")}
        <details><summary>Task and location</summary><p>${escape(loop.task)}</p><p>${escape(loop.mode)} / ${escape(loop.agent)}</p><p class="path">${escape(loop.path)}</p>
        <small>ETA extrapolates session durations and worker count; retries and gates can change it.</small></details>
        </section>
        <section class="panel"><h2>Now</h2>${loop.current.length ? loop.current.map(item => `<article>
        <h3>${escape(item.id)} / ${escape(item.description)}</h3><small>Worker ${escape(item.worker ?? 1)} / ${duration(item.elapsed)} / prior attempts ${escape(item.attempt ?? "unknown")}</small>
        <div class="steps">${["orient", "implement", "gate", "review", "browser", "commit"].map(step => `<span class="${step === item.step ? "current" : ""}">${step === item.step ? "Now: " : ""}${step}</span>`).join("")}</div>
        <pre tabindex="0">${escape(item.logs.map(line => line.join("  ")).join("\n") || "Waiting for log events.")}</pre></article>`).join("") : "<p>No active item.</p>"}</section>
        <section class="panel"><h2>Up next</h2>${loop.next.length ? loop.next.map(item => `<div class="item"><strong>${escape(item.id)}</strong> ${escape(item.description)}<br><small>${item.blocked ? "Blocked in progress notes" : item.waiting.length ? `Waiting for ${escape(item.waiting.join(", "))}` : "Dependencies ready"}${item.attempts != null ? ` / ${escape(item.attempts)} prior attempts` : ""}</small></div>`).join("") : "<p>No pending items.</p>"}</section>
        <section class="panel"><h2>Recent sessions</h2>${loop.recent.length ? loop.recent.map(item => `<div class="item">${escape(item.item)} / ${escape(item.outcome || "unknown outcome")}<br><small>${duration(Number.isFinite(item.duration_ms) ? item.duration_ms / 1000 : null)} / ${money(item.cost_usd)} / ${escape(item.agent || "unknown agent")}</small></div>`).join("") : "<p>No session telemetry yet.</p>"}
        ${loop.notes.map(note => `<p class="muted">${escape(note.slice(3))}</p>`).join("")}</section>
        <section class="panel"><h2>Usage</h2><p>${loop.usage.sessions} sessions / ${loop.usage.unpriced} unpriced / ${number(loop.usage.premium)} premium requests</p>
        ${loop.usage.partial ? '<p class="warning">Large telemetry file: totals cover only the latest 2 MB, not the entire run.</p>' : ""}
        <p>Models: ${escape(loop.usage.models.join(", ") || "Not reported")}</p>
        <details><summary>Token detail</summary><p>Input ${number(loop.usage.input)} / output ${number(loop.usage.output)} / cache read ${number(loop.usage.cacheRead)} / cache write ${number(loop.usage.cacheWrite)}</p><p class="muted">Copilot does not report loop token or dollar usage. Unknown is not zero.</p></details></section>
        <section class="panel"><h2>This machine</h2><p>${loop.machine ? `${escape(loop.machine.in_use ?? "Unknown")} / ${escape(loop.machine.sessions ?? "Unknown")} loop session slots in use` : "Machine slot telemetry unavailable."}</p><small>Last driver snapshot; not a new machine-wide process scan.${loop.state === "queued" ? " Queued, waiting for a free slot." : ""}</small></section>`;
}
function render(state) {
    latest = state;
    const loops = [...state.loops].sort((a, b) => Number(["running", "stopping", "queued"].includes(b.state)) - Number(["running", "stopping", "queued"].includes(a.state)));
    if (!loops.some(l => l.path === selected)) selected = loops[0]?.path;
    $("source-count").textContent = `${state.roots.length} selected${state.hidden ? `, ${state.hidden} removed loop${state.hidden === 1 ? "" : "s"} hidden` : ""}`;
    if (!sourcesShown) { $("sources").open = state.roots.length === 0; sourcesShown = true; }
    $("roots").innerHTML = state.roots.map(root => `<li class="path">${escape(root)}</li>`).join("") || "<li>None selected yet.</li>";
    $("source-errors").innerHTML = state.errors.map(e => `<p class="warning">${escape(e)}</p>`).join("");
    const buttons = loops.map(loop => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-current", String(loop.path === selected));
        const s = status(loop, now());
        button.className = `tone-${s.tone}`;
        button.innerHTML = `<strong>${escape(loop.name)}</strong><span class="summary">${escape(s.label)}${loop.error ? "" : ` / ${loop.done} of ${loop.total} (${s.percent}%)`}</span><small>${escape(s.detail)}</small>`;
        button.onclick = () => { selected = loop.path; renderDetail(); for (const b of $("loops").children) b.setAttribute("aria-current", String(b === button)); };
        return button;
    });
    const focusedIndex = document.activeElement?.parentElement === $("loops") ? Array.from($("loops").children).indexOf(document.activeElement) : -1;
    $("loops").replaceChildren(...buttons);
    if (focusedIndex >= 0) buttons[focusedIndex]?.focus();
    renderDetail();
    $("connection").textContent = `${$("live").checked ? "Live" : "Paused"} / updated ${new Date(state.gatheredAt).toLocaleTimeString()}`;
}
function renderDetail() {
    // Keep keyboard and screen-reader reading positions stable during polling.
    if ($("main").contains(document.activeElement) && document.activeElement.matches("pre, summary")) return;
    const loop = latest.loops.find(l => l.path === selected);
    const focus = document.activeElement?.id;
    const openDetails = [...$("main").querySelectorAll("details")].map(d => d.open);
    $("main").innerHTML = loop ? details(loop) : "<h2>No loops found</h2><p>Add a directory containing .loop/feature_list.json, or its repository root, under Sources. No loop will be started.</p>";
    $("main").querySelectorAll("details").forEach((d, i) => { d.open = openDetails[i] || false; });
    if (focus && $("main").contains($(focus))) $(focus).focus();
    if ($("stop")) $("stop").onclick = async () => {
        if (!confirm("Request a graceful stop? Current sessions finish normally; no process will be killed.")) return;
        try { render(await request("/api/control", { path: loop.path, action: "stop" })); error(""); }
        catch (e) { error(e.message); }
    };
    if ($("remove")) $("remove").onclick = async () => {
        if (!confirm(`Remove "${loop.name}" from this dashboard? Its .loop files and the running driver are not touched. Add its path under Sources to show it again.`)) return;
        try { render(await request("/api/remove", { path: loop.path })); error(""); $("main").focus(); }
        catch (e) { error(e.message); }
    };
    if ($("rename")) $("rename").onclick = () => {
        renaming = loop.path; $("loop-name").value = loop.name; $("rename-error").textContent = "";
        $("rename-dialog").showModal();
    };
}
async function refresh() {
    if (pending) return;
    pending = true;
    try { render(await request("/api/state")); error(""); }
    catch (e) { error(e.message); $("connection").textContent = "Disconnected / retrying"; }
    finally { pending = false; }
}
$("refresh").onclick = refresh;
$("source-form").onsubmit = async event => {
    event.preventDefault();
    try { render(await request("/api/root", { path: $("path").value.trim() })); $("path").value = ""; error(""); }
    catch (e) { error(e.message); }
};
$("rename-form").onsubmit = async event => {
    event.preventDefault();
    try {
        const state = await request("/api/control", { path: renaming, action: "rename", name: $("loop-name").value });
        $("rename-dialog").close(); render(state); error("");
    } catch (e) { $("rename-error").textContent = e.message; }
};
$("cancel-rename").onclick = () => $("rename-dialog").close();
setInterval(() => { if ($("live").checked && !document.hidden && !$("rename-dialog").open) void refresh(); }, 3000);
void refresh();
