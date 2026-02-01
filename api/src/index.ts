import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// Import auth middleware
import { authMiddleware, verifyAuth } from "./auth.js";

// Import routes
import statusRouter from "./routes/status.js";
import logsRouter from "./routes/logs.js";
import sessionsRouter from "./routes/sessions.js";
import skillsRouter from "./routes/skills.js";
import memoryRouter from "./routes/memory.js";
import restartRouter from "./routes/restart.js";
import jobsRouter from "./routes/jobs.js";
import mcpRouter from "./routes/mcp.js";
import configRouter from "./routes/config.js";
import chatRouter from "./routes/chat.js";
import chatFilesRouter from "./routes/chat-files.js";
import oauthRouter from "./routes/oauth.js";
import discordRouter from "./routes/discord.js";
import gchatRouter from "./routes/gchat.js";
import watcherFixRouter from "./routes/watcher-fix.js";
import systemRouter from "./routes/system.js";
import cronRouter from "./routes/cron.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.API_PORT || 3100;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === "production"
    ? undefined  // Same origin in production
    : ["http://localhost:5173", "http://localhost:3000"], // Dev frontends
  credentials: true,
}));
app.use(express.json());

// Health check (no auth required)
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Auth verification endpoint (no middleware, handled in route)
app.get("/api/auth/verify", verifyAuth);

// OAuth routes (no auth required - they handle their own redirects)
app.use("/api/oauth", oauthRouter);

// All other routes require authentication
app.use("/api/status", authMiddleware, statusRouter);
app.use("/api/logs", authMiddleware, logsRouter);
app.use("/api/sessions", authMiddleware, sessionsRouter);
app.use("/api/skills", authMiddleware, skillsRouter);
app.use("/api/memory", authMiddleware, memoryRouter);
app.use("/api/restart", authMiddleware, restartRouter);
app.use("/api/jobs", authMiddleware, jobsRouter);
app.use("/api/mcp", authMiddleware, mcpRouter);
app.use("/api/config", authMiddleware, configRouter);
app.use("/api/chat", authMiddleware, chatRouter);
app.use("/api/chat/files", authMiddleware, chatFilesRouter);
app.use("/api/discord", authMiddleware, discordRouter);
app.use("/api/gchat", authMiddleware, gchatRouter);
app.use("/api/watcher/fix", authMiddleware, watcherFixRouter);
app.use("/api/system", authMiddleware, systemRouter);
app.use("/api/cron", authMiddleware, cronRouter);

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error", details: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
