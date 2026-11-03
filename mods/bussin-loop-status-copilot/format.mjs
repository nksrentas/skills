// Pure formatting shared by the panel (app.js) and the tests.
export const duration = value => value == null ? "Unknown"
    : value < 60 ? `${Math.round(value)}s`
    : value < 3600 ? `${Math.round(value / 60)}m`
    : `${Math.floor(value / 3600)}h ${Math.round(value % 3600 / 60)}m`;

const pad = value => String(value).padStart(2, "0");

export function clock(when, now = new Date()) {
    const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
    if (when.toDateString() === now.toDateString()) return time;
    return `${when.toLocaleDateString("en", { weekday: "short" })} ${time}`;
}

// One glanceable answer per loop: what it is doing and when it will be ready.
export function status(loop, now = Date.now()) {
    const today = new Date(now);
    const percent = loop.total ? Math.round(loop.done / loop.total * 100) : 0;
    const at = seconds => clock(new Date(seconds * 1000), today);
    const result = (tone, label, detail) => ({ tone, label, detail, percent });
    if (loop.error) return result("alert", "Artifact error", loop.error);
    if (loop.driverLost) return result("alert", "Driver not running", "loop.sh exited. Restart it to resume.");
    switch (loop.state) {
        case "finished":
            return result("done", "Finished", loop.endedAt ? `Finished at ${at(loop.endedAt)}` : "Every item passes.");
        case "stopped":
            return result("stopped", "Stopped", `${loop.endedAt ? `Stopped at ${at(loop.endedAt)}. ` : ""}Run loop.sh again to resume.`);
        case "stopping":
            return result("waiting", "Stopping", "Current items finish, then the driver exits.");
        case "queued":
            return result("waiting", "Queued", "Waiting for a free session slot on this machine.");
        case "running":
            if (loop.eta == null) return result("running", "Running", "Waiting for the first item to finish before estimating.");
            return result("running", "Running", `Ready ~${clock(new Date(now + loop.eta * 1000), today)}, in ${duration(loop.eta)}`);
        default:
            return result("stopped", "Not running", "Driver not running. Start loop.sh to begin.");
    }
}
