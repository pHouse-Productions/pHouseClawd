import { Router, Request, Response } from "express";
import fs from "fs/promises";

const router = Router();

// Path to the cron config file
const CRON_CONFIG_FILE = "/home/ubuntu/assistant/config/cron.json";
const CRON_MCP_URL = "http://localhost:3002/mcp";

// Session management for MCP connection
let sessionId: string | null = null;

interface CronJob {
  id: string;
  schedule: string;
  description: string;
  prompt: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

interface CronConfig {
  jobs: CronJob[];
}

// Read cron config directly
async function readCronConfig(): Promise<CronConfig> {
  try {
    const content = await fs.readFile(CRON_CONFIG_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { jobs: [] };
  }
}

// Parse SSE response to extract JSON data
function parseSSE(text: string): unknown {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        // Not valid JSON, continue
      }
    }
  }
  // Try parsing as plain JSON if no SSE format
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Initialize MCP session
async function initSession(): Promise<string> {
  const response = await fetch(CRON_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "dashboard-api", version: "1.0.0" },
      },
    }),
  });

  const sid = response.headers.get("mcp-session-id");
  if (!sid) {
    throw new Error("Failed to get session ID from MCP server");
  }
  sessionId = sid;

  // Send initialized notification
  await fetch(CRON_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  return sessionId;
}

// Helper to call cron MCP server for mutations
async function callCronMcp(method: string, params: Record<string, unknown> = {}) {
  // Ensure we have a session
  if (!sessionId) {
    await initSession();
  }

  const response = await fetch(CRON_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "mcp-session-id": sessionId!,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: method,
        arguments: params,
      },
    }),
  });

  // Check for session expiry and retry
  if (response.status === 400) {
    sessionId = null;
    await initSession();
    return callCronMcp(method, params);
  }

  // Parse SSE or JSON response
  const text = await response.text();
  const data = parseSSE(text) as { error?: { message?: string }; result?: { content?: Array<{ type: string; text?: string }> } } | null;

  if (!data) {
    throw new Error("Failed to parse MCP response");
  }

  if (data.error) {
    throw new Error(data.error.message || "MCP error");
  }

  return { success: true };
}

// List all jobs - read directly from config file for structured data
router.get("/", async (_req: Request, res: Response) => {
  try {
    const config = await readCronConfig();
    res.json({ jobs: config.jobs });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get single job
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const config = await readCronConfig();
    const job = config.jobs.find((j) => j.id === req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Create job - use MCP then reload config
router.post("/", async (req: Request, res: Response) => {
  try {
    const { schedule, description, prompt, enabled } = req.body;
    await callCronMcp("create_job", {
      schedule,
      description,
      prompt,
      enabled: enabled !== false,
    });
    // Return updated job list
    const config = await readCronConfig();
    res.json({ success: true, jobs: config.jobs });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Edit job - use MCP then reload config
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { schedule, description, prompt, enabled } = req.body;
    const params: Record<string, unknown> = { id: req.params.id };
    if (schedule !== undefined) params.schedule = schedule;
    if (description !== undefined) params.description = description;
    if (prompt !== undefined) params.prompt = prompt;
    if (enabled !== undefined) params.enabled = enabled;

    await callCronMcp("edit_job", params);
    // Return updated job
    const config = await readCronConfig();
    const job = config.jobs.find((j) => j.id === req.params.id);
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Toggle job - use MCP then reload config
router.post("/:id/toggle", async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    await callCronMcp("toggle_job", {
      id: req.params.id,
      enabled,
    });
    // Return updated job
    const config = await readCronConfig();
    const job = config.jobs.find((j) => j.id === req.params.id);
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Delete job - use MCP then reload config
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    await callCronMcp("delete_job", { id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
