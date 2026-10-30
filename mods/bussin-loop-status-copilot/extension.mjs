import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { startServer, stopServer, refreshServer } from "./server.mjs";

// Adapted from github/awesome-copilot/extensions/git-worktree-explorer (MIT).
await joinSession({
    canvases: [createCanvas({
        id: "autoloop-dashboard",
        displayName: "Autoloop Dashboard",
        description: "Live local bussin-autoloop progress, logs, usage and graceful stop across selected repositories and worktrees.",
        inputSchema: {
            type: "object", additionalProperties: false,
            properties: { projectPath: { type: "string", minLength: 1 } },
        },
        actions: [{
            name: "refresh",
            description: "Read the latest loop artifacts.",
            inputSchema: { type: "object", additionalProperties: false, properties: {} },
            handler: async (ctx) => {
                try { return await refreshServer(ctx.instanceId); }
                catch (error) { throw new CanvasError("loop_refresh_failed", error.message); }
            },
        }],
        open: async (ctx) => {
            try {
                const entry = await startServer(ctx.instanceId, {
                    projectPath: ctx.input?.projectPath || ctx.session?.workingDirectory,
                });
                return { title: "Autoloop Dashboard", url: entry.url };
            } catch (error) { throw new CanvasError("loop_open_failed", error.message); }
        },
        onClose: async (ctx) => stopServer(ctx.instanceId),
    })],
});
